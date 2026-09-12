# DotNaos UI native preview

Canonical implementation: `DotNaos/ui`, commit `d7643935725315fe445e90b3561773313fbb07db`, under `components/ui/native` (UI PR #194).

The 15 KB archive is built by that repository’s `components/ui/scripts/pack-native-preview.mjs`. It contains the shared native library and exposes the normal `@dotnaos/ui/native` entry point; it is not an app-specific implementation or node_modules patch. npm’s lockfile verifies the archive integrity.

Reason for this temporary pinned distribution: npm release jobs currently cannot start because the GitHub-hosted Actions budget is exhausted. No npm publication is claimed. Once a normal @dotnaos/ui release includes this source, only the dependency/version and lockfile need to change; app imports stay unchanged.

Regenerate only from a clean, committed UI checkout:

```sh
node components/ui/scripts/pack-native-preview.mjs /path/to/study-space/mobile/vendor
```

Do not edit the archive or copy its components into Study Space. Make changes in DotNaos UI, run its native tests, and package a new source-pinned version.
