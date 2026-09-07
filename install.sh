#!/bin/sh
# Study Space bootstrap. No Rust compiler is needed on the destination machine.
set -eu
umask 077

fail() { printf '\nStudy Space: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' is missing. Install it and rerun this command."; }

[ "$(uname -s)" = Linux ] || fail 'This release supports Linux x86_64. Run the installer on your Linux Tailnet host.'
[ "$(uname -m)" = x86_64 ] || fail 'This release supports Linux x86_64 only.'
[ "$(id -u)" -ne 0 ] || fail 'Run this installer as your normal user, not root. It requests sudo for machine configuration.'
for tool in curl tar sha256sum awk mktemp flock; do need "$tool"; done

study_home=${STUDY_HOME:-"$HOME/.local/share/study-space"}
study_bin=${STUDY_BIN_DIR:-"$HOME/.local/bin"}
release_base=${STUDY_RELEASE_BASE:-https://github.com/DotNaos/study-space/releases/latest/download}
case "$study_home:$study_bin" in /*:/*) ;; *) fail 'Installation and binary directories must be absolute paths.' ;; esac
case "$release_base" in https://*) ;; *) fail 'Release downloads require HTTPS.' ;; esac
mkdir -p "$study_home" "$study_bin"
chmod 700 "$study_home"
exec 9>"$study_home/installer.lock"
flock -n 9 || fail 'Another Study Space installer is already running. Wait for it to finish.'
work=$(mktemp -d "$study_home/.install.XXXXXXXX")
activated=0
cleanup() {
    result=$?
    trap - EXIT HUP INT TERM
    if [ "$result" -ne 0 ] && [ "$activated" -eq 1 ] && [ -f "$work/previous-study" ]; then
        cp -p "$work/previous-study" "$study_bin/.study.rollback.$$"
        mv -f "$study_bin/.study.rollback.$$" "$study_bin/study"
    fi
    rm -rf "$work"
    exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
fetch() {
    curl --fail --silent --show-error --location --retry 3 --connect-timeout 10 --max-time 300 \
        --proto '=https' --tlsv1.2 "$1" --output "$2"
}

printf 'Downloading Study Space release information…\n'
fetch "$release_base/VERSION" "$work/VERSION"
version=$(cat "$work/VERSION")
case "$version" in ''|.*|*[!a-zA-Z0-9._-]*) fail 'The release version is invalid.' ;; esac
[ "${#version}" -le 100 ] || fail 'The release version is invalid.'
asset_base=$release_base
case "$release_base" in
    */releases/latest/download) asset_base=${release_base%/latest/download}/download/v$version ;;
esac
fetch "$asset_base/VERSION" "$work/PINNED_VERSION"
[ "$(cat "$work/PINNED_VERSION")" = "$version" ] || fail 'Release changed during download. Rerun the installer.'
fetch "$asset_base/SHA256SUMS" "$work/SHA256SUMS"

verify_asset() {
    asset=$1
    fetch "$asset_base/$asset" "$work/$asset"
    expected=$(awk -v name="$asset" '$2 == name { print $1; count++ } END { if (count != 1) exit 1 }' "$work/SHA256SUMS") \
        || fail "Release manifest lacks a unique checksum for $asset."
    [ "${#expected}" -eq 64 ] || fail "Invalid checksum for $asset."
    case "$expected" in *[!0-9a-fA-F]*) fail "Invalid checksum for $asset." ;; esac
    actual=$(sha256sum "$work/$asset")
    actual=${actual%% *}
    [ "$actual" = "$expected" ] || fail "Checksum verification failed for $asset. Existing installation is unchanged."
    tar -tzf "$work/$asset" >"$work/archive-list"
    awk 'BEGIN { bad=0 } /^\// { bad=1 } /(^|\/)\.\.(\/|$)/ { bad=1 } END { exit bad }' "$work/archive-list" \
        || fail "Unsafe archive paths in $asset."
    tar -tvzf "$work/$asset" >"$work/archive-types"
    awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" { bad=1 } END { exit bad }' "$work/archive-types" \
        || fail "Unsupported links or special files in $asset."
}
verify_asset study-linux-x86_64.tar.gz
verify_asset study-space-bundle.tar.gz
mkdir "$work/cli" "$work/bundle"
tar -xzf "$work/study-linux-x86_64.tar.gz" --no-same-owner -C "$work/cli"
tar -xzf "$work/study-space-bundle.tar.gz" --no-same-owner -C "$work/bundle"
[ -f "$work/cli/bin/study" ] || fail 'Release archive lacks bin/study.'
[ -f "$work/bundle/compose.yaml" ] || fail 'Application bundle lacks compose.yaml.'
[ -f "$work/bundle/release.env" ] || fail 'Application bundle lacks release.env.'
[ -f "$work/bundle/source/Dockerfile" ] || fail 'Application bundle lacks the released Dockerfile.'
[ -f "$work/bundle/source/.dockerignore" ] || fail 'Application bundle lacks the released build context rules.'
[ -d "$work/bundle/source/server" ] && [ -d "$work/bundle/source/web" ] || fail 'Application bundle lacks released application source.'
chmod 755 "$work/cli/bin/study"
"$work/cli/bin/study" --version

# Activate the executable atomically; restore it if updating the runtime fails.
if [ -f "$study_bin/study" ]; then cp -p "$study_bin/study" "$work/previous-study"; fi
cp "$work/cli/bin/study" "$study_bin/.study.next.$$"
chmod 755 "$study_bin/.study.next.$$"
mv -f "$study_bin/.study.next.$$" "$study_bin/study"
activated=1
if ! STUDY_RELEASE_BASE="$release_base" "$study_bin/study" --home "$study_home" setup --bundle "$work/bundle" --version "$version"; then
    fail 'Setup failed. Your persistent data is preserved. Read the error above, then rerun the installer.'
fi
case ":$PATH:" in
    *":$study_bin:"*) ;;
    *) printf '\nAdd the CLI to your shell PATH:\n  export PATH="%s:$PATH"\n' "$study_bin" ;;
esac
