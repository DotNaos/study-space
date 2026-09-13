# Documentation export

Study Space exports its project-owned `docs/` through the Project Template `docs.content` module. The synced implementation is `scripts/docs-content.mjs`, tracked in `.project/modules.lock.json`; authored docs and application config remain project-owned. The selected exporter catalog is vendored at `vendor/docs-content`; its export digest and module lock make this pin portable without a sibling checkout. Refresh it using `project-template export <fresh-directory> --source <canonical-checkout> --module docs.content`, review/replace the vendored catalog, then run `project-template update . --apply` and `project-template validate .`. Normalize the CLI-written catalog source back to the repository-relative `vendor/docs-content` before committing.

`bun run --cwd web dev` serves fresh `/docs-content/manifest.json` and raw pages locally with `revision: development`. `bun run --cwd web build` includes real pages/assets in `web/dist/docs-content`; production builds use the exact Git SHA from the existing `COMMIT` Docker build argument through `DOCS_CONTENT_REVISION`. The release source bundle includes authored docs and the synced exporter. Missing production revision is an error.

The existing ASP.NET application serves built docs separately from its SPA fallback. Only docs routes permit exact `DOCS_CONTENT_ORIGIN` (default `https://architecture.os-pc.vpn.os-home.net`), GET/HEAD/OPTIONS, `Vary: Origin` and `no-store`. Unknown origins receive 403, missing files 404. No API/auth/host rule is weakened; the private Tailnet boundary remains. For local Architecture tests set `DOCS_CONTENT_ORIGIN=http://127.0.0.1:3400` explicitly. CORS is anonymous and never uses a wildcard or token URL.

Every Markdown/MDX source gets a stable chapter and revision-pinned source link. MDX is explicitly unsupported raw text, never executed. Symlinks and unsafe paths fail export. Only docs-local PNG/JPEG/GIF/WebP/AVIF images are exported. The [Architecture v1 wire contract](https://github.com/DotNaos/architecture/blob/main/content/docs/documentation-content.mdx) and [Project Template exporter usage](https://github.com/DotNaos/project-template/blob/main/docs/documentation-content.md) are canonical.

Validation: exporter/module tests run in Project Template; Study Space's normal web test/build checks production bundling, `DocumentationContentTests` checks the real ASP.NET pipeline, and Architecture's browser integration exercises both real producer exports together. The narrow catalog contains only `docs.content`; it does not install baseline scaffolding or alter Study Space's existing instructions, setup, source structure, docs or `.gitignore`.


## Standalone documentation site

The same project-owned sources also build `apps/docs`, a static Fumadocs site served by the normal Study Space ASP.NET application at `/docs/`. There is no second documentation server and no copied authoring tree: the build reads the repository `README.md`, `docs/`, `docs/navigation.json`, and the same pinned `scripts/docs-content.mjs` used by `/docs-content`.

Architecture consumes `/docs-content/manifest.json` and renders those bytes in its own project drilldown. The standalone site renders the same pages and navigation directly. Navigation labels/icons, README availability, Mermaid diagrams and source provenance therefore change in one repository and reach both surfaces in the next release.
