import { fileURLToPath } from "node:url";
// @ts-expect-error The synced module is dependency-free JavaScript.
import { docsContent } from "../scripts/docs-content.mjs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [docsContent({ origin: process.env.DOCS_CONTENT_ORIGIN ?? "https://architecture.os-pc.vpn.os-home.net", root: fileURLToPath(new URL("../", import.meta.url)), projectId: "study-space", title: "Study Space", repositoryUrl: "https://github.com/DotNaos/study-space" }), react(), tailwindcss()],
  build: { outDir: "dist", sourcemap: false, rollupOptions: { input: { app: "index.html", reader: "reader.html" } } },
});
