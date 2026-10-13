#!/usr/bin/env bash
# The digest-pinned Docker image is an OCaml bootstrap, not the proof oracle.
# Its 9.3 alias currently points at 9.3-rc1. Install exact stable OPAM packages.
set -euo pipefail
command -v opam >/dev/null
opam update --yes
# The bootstrap image pins its development compiler. Drop only pins for the
# exact packages this disposable container is about to replace.
pins=$(opam pin list --short)
for package in rocq-runtime rocq-core coq-core rocq-stdlib; do
  if printf '%s\n' "$pins" | grep -Fxq "$package"; then
    opam pin remove --yes --no-action "$package"
  fi
done
opam install --yes --jobs=2 \
  rocq-runtime.9.3.0 rocq-core.9.3.0 coq-core.9.3.0 rocq-stdlib.9.2.0
eval "$(opam env)"
version=$(rocq --version)
printf '%s\n' "$version"
if ! printf '%s\n' "$version" | grep -Eq 'version 9[.]3[.]0([[:space:]]|$)'; then
  echo 'The installed proof oracle must be stable Rocq 9.3.0' >&2
  exit 1
fi
opam list --installed --columns=name,version rocq-runtime rocq-core coq-core rocq-stdlib
