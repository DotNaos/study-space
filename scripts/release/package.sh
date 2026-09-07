#!/usr/bin/env bash
set -euo pipefail
version=${1:?usage: package.sh VERSION COMMIT}
commit=${2:?commit required}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]] || { echo 'Invalid version' >&2; exit 1; }
[[ "$commit" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit' >&2; exit 1; }
git cat-file -e "$commit^{commit}"
image="study-space-local:v$version-$commit"
out="${STUDY_ARTIFACTS_DIR:-artifacts}"
mkdir -p "$out"
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/cli/bin" "$staging/bundle/source"
cp cli/target/release/study "$staging/cli/bin/study"
# The release's build inputs come from its commit, never the checkout or local
# generated files. This also prevents a dirty compose file or installer leaking.
git archive "$commit" -- Dockerfile .dockerignore server web | tar -x -C "$staging/bundle/source"
git show "$commit:compose.yaml" > "$staging/bundle/compose.yaml"
git show "$commit:install.sh" > "$out/install.sh"
printf 'STUDY_IMAGE=%s\nSTUDY_VERSION=v%s\nSTUDY_COMMIT=%s\nSTUDY_SCHEMA_VERSION=1\n' "$image" "$version" "$commit" > "$staging/bundle/release.env"
printf '%s\n' "$version" > "$out/VERSION"
printf '{"version":"%s","commit":"%s","image":"%s","schemaVersion":1}\n' "$version" "$commit" "$image" > "$out/manifest.json"
tar -C "$staging/cli" -czf "$out/study-linux-x86_64.tar.gz" bin/study
tar -C "$staging/bundle" -czf "$out/study-space-bundle.tar.gz" compose.yaml release.env source
(cd "$out" && sha256sum VERSION manifest.json install.sh study-linux-x86_64.tar.gz study-space-bundle.tar.gz > SHA256SUMS)
