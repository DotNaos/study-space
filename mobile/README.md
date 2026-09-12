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

The temporary 15 KB source-pinned native library archive is documented in `vendor/README.md`; npm's lock integrity and the library source commit are tested. This distribution avoids depending on an unpublished npm version while UI publishing is blocked. It does not change the public import path.

```sh
npm ci
npm test
npm run typecheck
npx expo export --platform ios --platform android
```
