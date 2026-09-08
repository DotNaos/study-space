# Study Space

Your learning materials, on your own computer. Study Space runs a React app and PostgreSQL in Docker and opens through your machine's private Tailnet address.

## Install on os-pc

Run this on **os-pc**, as your normal user:

```sh
curl -fsSL https://github.com/DotNaos/study-space/releases/latest/download/install.sh | sh
```

The installer downloads the native `study` command and its matching source release, checks their SHA-256 checksums, builds the app on your machine, starts the containers, and registers its own route with the existing machine proxy. It needs Linux x86-64, Docker with Compose, `curl`, `tar`, `sha256sum`, Tailscale, sudo access, and enough disk space for the build. Docker downloads the public build tools, dependencies, and PostgreSQL image; no Study Space image is uploaded to or downloaded from GitHub Container Registry. The machine's [Systems proxy, wildcard DNS, and HTTPS certificate](https://github.com/DotNaos/systems/blob/main/docs/machine-proxy.md) must already be configured. Setup checks this and stops with an explanation if something is missing.

Open [Study Space on os-pc](https://study.os-pc.vpn.os-home.net) from a device on your Tailnet. The app is single-user: everyone allowed to reach this address through your Tailnet can use it. The application listens only on the host's loopback interface; PostgreSQL has no published port.

Repeating the command preserves the database, settings, and Moodle connection. Each release includes the source from its exact Git commit and locked application dependencies. Docker reuses its local build cache on later runs. The new image is built before the running release is replaced, so a failed build leaves the current app running. Schema-changing upgrades stop for a dedicated migration procedure; compatible failed updates restore the prior application release.

## Connect Moodle

1. Open **Quellen** and enter your Moodle address, including any path such as `/moodle`.
2. Follow the three setup steps shown in the browser-login screen. Request the return link, allow Chrome’s prompt, and select your Study Space host as the default under `web+studyspace` at `chrome://settings/handlers`. Being listed there is not enough; the entry must show **Default**. Then open Moodle in a new tab. Keep the original Study Space tab open; it checks for completion automatically.
3. Sign in on your school's website. Moodle shows its app-return page. If it does not return automatically, use the visible link to open the app. Study Space verifies and saves the connection. If the link does nothing in Chrome, open Settings → Privacy and security → Site settings → Additional permissions → Protocol handlers, then select **Set as default** from the Study Space entry’s menu under `web+studyspace`. A listed handler is not necessarily the default.
4. Open **Kurse** to browse your enrolled courses by semester, with their Moodle cover images. Search by course name or semester. Courses without a clear HS/FS year appear under **Allgemein**; courses without an uploaded image have a simple placeholder. Open a course and use its section navigator to browse activities and files. Links open the original material in Moodle; downloading and processing materials is a later step.

Browser login uses Moodle's mobile-app launch flow with a registered `web+studyspace` return link. The return address stays the same across attempts; the server matches each return to the current single-use login. Use a supporting desktop browser such as Chrome or Edge. Study Space never assumes that you granted the browser's permission; it explains the required step. Safari and some embedded/mobile browsers do not support this return mechanism.

If your school enables profile QR login, it is also available as a fallback: sign in to Moodle, display the mobile-app login QR in your profile, and upload a screenshot. The image is decoded in your browser; only the decoded pairing request goes to your own Study Space server. QR login can require the browser and os-pc to use the same public internet address. Being on the same Tailnet alone does not guarantee this. Use the same home connection or an exit node you have already configured. Study Space does not change VPN settings.

Connection requests expire after five minutes and can be used once. Study Space verifies the returned Moodle site and account before saving a token. Passwords are entered only on Moodle. Tokens and encryption keys stay in a private directory on os-pc; disconnecting removes the saved token.

The school must enable Moodle mobile web services and a supported login method. Only courses available to the connected Moodle account are shown. Material import, script/exercise generation, and Codex integration are a later milestone.

The Moodle address is saved for this single-user installation in the generated `data/app/config.json` file under the installation directory. Fresh installations have no school address configured. Saving an address in the app updates this file for every browser; clearing it does not silently disconnect an existing Moodle account. The file contains configuration only, while login credentials remain in the separate private directory.

## Manage the installation

```sh
study status
study doctor
study stop
study start
study logs
study update
study moodle status
study moodle discover https://moodle.example.edu
study moodle set-site https://moodle.example.edu
study moodle courses
study moodle course 123
```

The command is installed in `~/.local/bin/study`. If your shell does not find it, use that full path or add `~/.local/bin` to your PATH. Persistent state defaults to `~/.local/share/study-space/`: `data/` holds PostgreSQL and application data, `secrets/` holds private credentials, and `releases/` retains installed bundles. Do not delete these directories to update the app.

**Backup status:** automated backup/restore and Google Drive connection are tracked in [#9](https://github.com/DotNaos/study-space/issues/9), and are not included in this Moodle-login checkpoint. Do not treat the installation as a verified backup system yet.

## Development and verification

Use Bun 1.3.9, .NET 10, Rust 1.93, and Docker. Portable checks and image builds can run on a separate Linux machine; keep the same source revision and lockfiles.

```sh
cd web && bun install --frozen-lockfile && bun run build
cd ../server && dotnet test StudySpace.Api.Tests/StudySpace.Api.Tests.csproj
cd ../cli && cargo test --locked && cargo build --release --locked
cd .. && python3 scripts/install/test_installer.py
docker build -t study-space:development .
```

The container includes the web build and applies PostgreSQL migrations before accepting traffic. See [the implementation contract](docs/implementation-contract.md) for the API and runtime boundaries. CI runs synthetic Moodle and installer tests without school accounts or real credentials. The release workflow creates the CLI archive, immutable application bundle, checksums, and installer together from a tagged commit on `main`.
