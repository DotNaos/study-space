# Study Space Mobile

React Native / Expo client for the existing Study Space server.

The app defaults to `https://study.os-pc.vpn.os-home.net`. Override it with `EXPO_PUBLIC_STUDY_BASE_URL` when developing against another Study Space host.

```sh
npm install
npm start
```

Use Expo Go first. The phone must be able to reach the configured Study Space host, normally through Tailscale.

## Shared native UI

`@dotnaos/ui/native` owns `ListItem`, `Icon.File`, `SectionHeader`, `SearchField`, `Screen`, `NativeThemeProvider`, typography and tokens. Study Space only supplies course data, navigation actions and course image URLs. Do not recreate row styling, file-type artwork, search controls or palettes here.

Both course views use plain divider-separated rows; section titles retain normal casing. The search footer lives outside the scrollable course list with keyboard avoidance and bottom safe area. UI icons are Lucide; `expo-image` is only used for actual course images.

The temporary source-pinned native library archive is documented in `vendor/README.md`; npm's lock integrity and the library source commit are tested. This distribution avoids depending on an unpublished npm version while UI publishing is blocked. It does not change the public import path.

```sh
npm ci
npm test
npm run typecheck
npx expo export --platform ios --platform android
```


## In-app content

Course files and activities open dedicated Expo Router pages; they never automatically launch Safari or another application. PDFs and supported images are displayed by `Viewer` from `@dotnaos/ui/native/document`. That shared native component hosts the application-owned `/reader.html` surface using the Expo-compatible WebView peer. The surface reuses the existing Study Space PDF.js and image viewers, including page navigation, zoom, bounded loading, and retry. It is not a third-party document service. An updated Study Space backend must serve `reader.html` and the module-detail endpoint.

Assignment pages load `GET /api/providers/moodle/courses/{courseId}/modules/{moduleId}`. They display Moodle descriptions/instructions, deadlines, the current learner's submission/grading state and file requirements when supplied. Missing or inaccessible fields stay explicitly unknown. Assignment attachments are distinct from related files in the same section. An empty description is not synthesized from a neighboring PDF.

This version is **read-only**: no upload, edit or submission actions. Moodle Page text is supported with paragraph boundaries; inline HTML images currently appear as image/alt-text notices. Forum, quiz, book and arbitrary link content, password-protected PDFs, and Office previews are not fully supported yet; they show an in-app explanation rather than silently opening an external site. Source credentials stay on the backend. Unsupported file formats remain on a native information page.
