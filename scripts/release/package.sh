#!/usr/bin/env bash
set -euo pipefail
version=${1:?usage: package.sh VERSION IMAGE COMMIT}
image=${2:?image digest or tag required}
commit=${3:?commit required}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]] || { echo 'Invalid version' >&2; exit 1; }
[[ "$image" =~ ^ghcr.io/dotnaos/study-space[:@][a-zA-Z0-9:._-]+$ ]] || { echo 'Invalid image reference' >&2; exit 1; }
[[ "$commit" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit' >&2; exit 1; }
out="${STUDY_ARTIFACTS_DIR:-artifacts}"
mkdir -p "$out"
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/cli/bin" "$staging/bundle"
cp cli/target/release/study "$staging/cli/bin/study"
cp compose.yaml "$staging/bundle/"
printf 'STUDY_IMAGE=%s\nSTUDY_SCHEMA_VERSION=1\n' "$image" > "$staging/bundle/release.env"
printf '%s\n' "$version" > "$out/VERSION"
printf '{"version":"%s","commit":"%s","image":"%s","schemaVersion":1}\n' "$version" "$commit" "$image" > "$out/manifest.json"
tar -C "$staging/cli" -czf "$out/study-linux-x86_64.tar.gz" bin/study
tar -C "$staging/bundle" -czf "$out/study-space-bundle.tar.gz" compose.yaml release.env
cp install.sh "$out/install.sh"
(cd "$out" && sha256sum VERSION manifest.json install.sh study-linux-x86_64.tar.gz study-space-bundle.tar.gz > SHA256SUMS)
