# Study MCP

Study Space exposes a dedicated read-only MCP server for assistants that need the canonical course and learning context without using the in-app Codex runtime.

## Runtime

The MCP runs as its own `mcp` container from the same Study Space release image. It listens only on a host loopback port selected by the installer. `study doctor` prints the exact endpoint:

```text
Study MCP: http://127.0.0.1:<port>/mcp
```

The sidecar has no Study Space volumes, PostgreSQL credentials, Moodle token, Codex credentials, Docker socket, or host filesystem access. Its only data path is read-only HTTP requests to the Study Space app over the private Compose network. The local MCP endpoint is intended to sit behind an authenticated connector such as OpenAI Secure MCP Tunnel; it must not be published directly to the internet.

## Tools

- `study_status` — application and Moodle connection status.
- `study_courses` — enrolled course index and stable course IDs.
- `study_course` — bounded course sections, activities, and resource metadata.
- `study_learning` — saved script sections, exercises, source references, and optionally saved drafts or solutions.
- `study_materials` — prepared-material coverage and source inventory.
- `study_source` — bounded extracted source blocks by immutable material revision.
- `study_search` — bounded search across the active saved learning version and prepared source text.

All tool definitions are marked read-only. The implementation issues only `GET` requests to the Study Space API. It cannot start imports or generation, modify learning versions, save drafts, change reading state, write to Moodle, or invoke Codex.

Solutions and personal answer drafts are omitted by `study_learning` unless the caller explicitly requests them. Tool outputs use bounded item counts and text lengths so assistants can fetch precise follow-up context instead of receiving an entire course in one response.

## Purpose

This MCP is the assistant-facing study interface. Moodle remains a source provider and Study Space remains the canonical local store for imported sources, generated learning content, exercise state, and source anchors. An assistant can therefore answer questions, solve or prepare exercises, and explain source material with its own model even when the Study Space Codex runtime is signed out or usage-limited.
