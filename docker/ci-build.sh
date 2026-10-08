#!/usr/bin/env bash
# Build, consume and remove only this invocation's labelled Docker resources.
set -euo pipefail
cd "$(dirname "$0")/.."

owner=${RML_DOCKER_OWNER:-relative-meta-logic-local}
run=${GITHUB_RUN_ID:-local-$(date +%s)-$$}-${GITHUB_RUN_ATTEMPT:-1}
owner_hash=$(printf '%s' "$owner" | sha256sum | cut -c1-12)
builder="rml-${owner_hash}-${run}"
node="${builder}0"
container="buildx_buildkit_${node}"
volume="${container}_state"
owner_label=org.link-foundation.rml.owner
run_label=org.link-foundation.rml.run
container_id=
volume_created=false
builder_created=false
images=()
mkdir -p .rml-cache/containers .rml-cache/reports .rml-cache/evidence
lease=".rml-cache/evidence/external-lease-$builder.json"

# Never adopt a pre-existing builder or volume, even if a name collides.
if docker buildx inspect "$builder" >/dev/null 2>&1 || docker volume inspect "$volume" >/dev/null 2>&1; then
  echo "Refusing to adopt existing Docker resources: $builder" >&2
  exit 1
fi

owned_volume() {
  [[ $(docker volume inspect "$volume" --format "{{ index .Labels \"$owner_label\" }}") == "$owner" ]] &&
    [[ $(docker volume inspect "$volume" --format "{{ index .Labels \"$run_label\" }}") == "$run" ]]
}

cleanup() {
  status=$?
  trap - EXIT INT TERM HUP
  set +e
  cleanup_status=0
  # Bash 3.2 (the macOS system shell) treats an empty array as unset under -u.
  for image_id in "${images[@]-}"; do
    [[ -n $image_id ]] || continue
    # Inspect the immutable ID, not a possibly reassigned tag. Never force-remove.
    if [[ $(docker image inspect "$image_id" --format "{{ index .Config.Labels \"$owner_label\" }}") == "$owner" ]] &&
       [[ $(docker image inspect "$image_id" --format "{{ index .Config.Labels \"$run_label\" }}") == "$run" ]]; then
      docker image rm "$image_id" || cleanup_status=1
    else
      echo "Refusing to remove image without matching ownership labels: $image_id" >&2
      cleanup_status=1
    fi
  done
  if [[ $volume_created == true ]]; then
    if owned_volume; then
      if [[ $builder_created == true ]]; then
        current_id=$(docker inspect "$container" --format '{{.Id}}' 2>/dev/null || true)
        mounted_volume=$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/buildkit"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || true)
        if [[ -n $container_id && $current_id == "$container_id" && $mounted_volume == "$volume" ]]; then
          # Buildx removes precisely this builder and its labelled state volume.
          docker buildx rm "$builder" || cleanup_status=1
        elif [[ -z $current_id && -z $container_id ]]; then
          # Creation failed before the container existed; only our volume remains.
          docker buildx rm "$builder" || cleanup_status=1
          if docker volume inspect "$volume" >/dev/null 2>&1; then
            owned_volume && docker volume rm "$volume" || cleanup_status=1
          fi
        else
          echo "Refusing to remove builder whose container identity changed: $builder" >&2
          cleanup_status=1
        fi
      else
        docker volume rm "$volume" || cleanup_status=1
      fi
    else
      echo "Refusing to remove builder state without matching ownership labels: $volume" >&2
      cleanup_status=1
    fi
  fi
  printf 'build_exit=%s\ncleanup_exit=%s\nbuilder=%s\n' "$status" "$cleanup_status" "$builder" > .rml-cache/reports/docker-lifecycle.txt
  if [[ $cleanup_status == 0 ]]; then rm -f "$lease"; fi
  # A cleanup failure must not mask the actual build/smoke-test failure.
  if [[ $status -eq 0 ]]; then status=$cleanup_status; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

printf '{"kind":"buildx","builder":"%s"}\n' "$builder" > "$lease"
volume_created=true
docker volume create --label "$owner_label=$owner" --label "$run_label=$run" "$volume"
owned_volume || { echo "Builder state ownership labels do not match" >&2; exit 1; }
# Set the marker before create so partially created builders are cleaned too.
builder_created=true
docker buildx create --name "$builder" --node "$node" --driver docker-container \
  --buildkitd-config docker/buildkitd.toml
# Capture the container identity even if bootstrap fails part way through.
bootstrap_status=0
docker buildx inspect --builder "$builder" --bootstrap || bootstrap_status=$?
container_id=$(docker inspect "$container" --format '{{.Id}}' 2>/dev/null || true)
if [[ $bootstrap_status -ne 0 ]]; then exit "$bootstrap_status"; fi

for implementation in js rust; do
  iidfile=".rml-cache/containers/${implementation}.iid"
  build_status=0
  docker buildx build --builder "$builder" --load --progress plain \
    --file "docker/Dockerfile.${implementation}" --tag "${builder}-${implementation}:ci" \
    --label "$owner_label=$owner" --label "$run_label=$run" \
    --iidfile "$iidfile" . || build_status=$?
  if [[ -s $iidfile ]]; then
    image_id=$(cat "$iidfile")
    [[ $image_id =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Invalid Docker image ID' >&2; exit 1; }
    images+=("$image_id")
  fi
  if [[ $build_status -ne 0 ]]; then exit "$build_status"; fi
  [[ -s $iidfile ]] || { echo 'Build succeeded without an image ID' >&2; exit 1; }
  bash docker/run-owned.sh "$image_id"
done

docker compose -f docker/docker-compose.yml config
