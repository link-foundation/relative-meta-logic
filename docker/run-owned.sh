#!/usr/bin/env bash
# A Docker daemon process is not an OS child. Hold an external lease until its
# exact labelled container has stopped, been waited for, and been removed.
set -euo pipefail
cd "$(dirname "$0")/.."
owner=${RML_DOCKER_OWNER:-relative-meta-logic-local}
run=${GITHUB_RUN_ID:-local}-$(date +%s)-$$
name="rml-owned-$run"
owner_label=org.link-foundation.rml.owner
run_label=org.link-foundation.rml.run
mkdir -p .rml-cache/evidence .rml-cache/containers
lease=".rml-cache/evidence/external-lease-$name.json"
cidfile=".rml-cache/containers/$name.cid"
printf '{"kind":"docker-container","name":"%s"}\n' "$name" > "$lease"
cleanup() {
  status=$?
  trap - EXIT INT TERM HUP
  set +e
  cleanup_status=0
  if [[ -s $cidfile ]]; then
    cid=$(cat "$cidfile")
    if [[ $cid =~ ^[0-9a-f]{64}$ ]] &&
       [[ $(docker container inspect "$cid" --format '{{.Id}}') == "$cid" ]] &&
       [[ $(docker container inspect "$cid" --format "{{ index .Config.Labels \"$owner_label\" }}") == "$owner" ]] &&
       [[ $(docker container inspect "$cid" --format "{{ index .Config.Labels \"$run_label\" }}") == "$run" ]]; then
      docker container stop --time 10 "$cid" >/dev/null &&
        docker container wait "$cid" >/dev/null &&
        docker container rm "$cid" >/dev/null || cleanup_status=1
    else
      echo "Refusing container teardown without matching ID and ownership: $cid" >&2
      cleanup_status=1
    fi
  else
    # A failed client may have created a container before writing its CID file.
    # Resolve only our exact random name and verify its labels on the next run.
    echo "Ambiguous container creation: $name; external lease preserved" >&2
    cleanup_status=1
  fi
  if [[ $cleanup_status == 0 ]]; then rm -f "$lease" "$cidfile"; fi
  if [[ $status == 0 ]]; then status=$cleanup_status; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
# Do not use --rm: retaining the exited container allows deterministic ID and
# label inspection before deletion, including when a client is interrupted.
docker run --name "$name" --cidfile "$cidfile" \
  --label "$owner_label=$owner" --label "$run_label=$run" "$@"
