// Disposable, synthetic browser-QA server. Never imports real data or credentials.
// Run after `bun run build`: bun tests/fixtures/server.ts
import { configureLearning, learningResponse } from "./learning-flow";
import { fileSections, fileResponse } from "./course-files";
import { syntheticCourseImage } from "./course-images";
const origin = process.env.STUDY_FIXTURE_ORIGIN || "http://localhost:18141";
const site = `${origin}/moodle`;
let mode = "connected";
let configuredSite: string | null = site;
let displayName = "Study Space";
let requests: string[] = [];
const syntheticLoginId = "a".repeat(64);
const htmlHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
};
const courses = [
  {
    id: 41,
    name: "Mathematik I · HS26",
    shortName: "MATH-HS26",
    summary: "Grundlagen und Übungen",
    imageUrl: "/api/providers/moodle/courses/41/image",
  },
  {
    id: 42,
    name: "Einführung in die Informatik",
    shortName: "2026_FS_INF",
    summary: "",
    imageUrl: "/api/providers/moodle/courses/42/image",
  },
  {
    id: 43,
    name: "Wissenschaftliches Arbeiten und interdisziplinäre Forschungsmethoden · 2025 FS",
    shortName: "2025_FS_WA",
    summary: "",
    imageUrl: "/api/providers/moodle/courses/43/image",
  },
  {
    id: 44,
    name: "Studienorganisation",
    shortName: "Studienorganisation",
    summary: "",
    imageUrl: null,
  },
  {
    id: 45,
    name: "Statistik · HS24",
    shortName: "STAT-HS24",
    summary: "",
    imageUrl: "/api/providers/moodle/courses/45/image",
  },
  {
    id: 46,
    name: "Seminar HS25 / FS26",
    shortName: "Seminar_HS25_FS26",
    summary: "",
    imageUrl: null,
  },
  {
    id: 47,
    name: "Biologie",
    shortName: "BIO-HS26",
    summary: "",
    imageUrl: "/api/providers/moodle/courses/47/image",
  },
];
const sections = [
  {
    id: 1,
    name: "Start und Organisation",
    summary: "Alle Unterlagen zum Kurs.",
    modules: [
      {
        id: 501,
        name: "Kursübersicht",
        type: "resource",
        url: `${site}/mod/resource/view.php?id=501`,
        description: "Ablauf, Termine und Lernziele.",
        resources: [
          {
            type: "file",
            name: "Kursübersicht_Herbstsemester_2026.pdf",
            mimeType: "application/pdf",
            size: 2621440,
            modifiedAt: 1788825600,
            url: null,
          },
        ],
      },
    ],
  },
  {
    id: 2,
    name: "Woche 1 · Funktionen",
    summary: "Funktionen, Mengen und erste Beweise.",
    modules: [
      {
        id: 502,
        name: "Vorlesung und Übungsblatt 01",
        type: "folder",
        url: `${site}/mod/folder/view.php?id=502`,
        description: "",
        resources: [
          {
            type: "file",
            name: "Vorlesung_01_Funktionen_und_Abbildungen_mit_ausführlichen_Beispielen.pdf",
            mimeType: "application/pdf",
            size: 845120,
            modifiedAt: null,
            url: null,
          },
          {
            type: "file",
            name: "Übungsblatt_01.pdf",
            mimeType: "application/pdf",
            size: null,
            modifiedAt: null,
            url: null,
          },
        ],
      },
      {
        id: 503,
        name: "Selbsttest: Funktionen",
        type: "quiz",
        url: `${site}/mod/quiz/view.php?id=503`,
        description: "Prüfe dein Verständnis mit fünf Fragen.",
        resources: [],
      },
      {
        id: 504,
        name: "Nicht verfügbare Aktivität",
        type: "unknown",
        url: null,
        description: "Diese Aktivität ist derzeit nicht verlinkt.",
        resources: [],
      },
      {
        id: 505,
        name: "Online-Atlas",
        type: "url",
        url: `${site}/mod/url/view.php?id=505`,
        description: "Ergänzende Beispiele zur Vorlesung.",
        resources: [
          {
            type: "url",
            name: "index.html",
            mimeType: null,
            size: 0,
            modifiedAt: null,
            url: null,
          },
        ],
      },
      {
        id: 506,
        name: "________________",
        type: "label",
        url: null,
        description: "----------------",
        resources: [],
      },
      {
        id: 507,
        name: "Hinweis zur Abgabe",
        type: "label",
        url: null,
        description:
          "Bitte die Lösungen bis Freitag hochladen.\n___________\nRückfragen sind im Forum möglich.",
        resources: [],
      },
      {
        id: 508,
        name: "Übungsblatt 02",
        type: "resource",
        url: `${site}/mod/resource/view.php?id=508`,
        description: "",
        resources: [
          {
            type: "file",
            name: "Übungsblatt_02.pdf",
            mimeType: "application/pdf",
            size: 0,
            modifiedAt: null,
            url: null,
          },
        ],
      },
    ],
  },
  { id: 3, name: "Woche 2", summary: "", modules: [] },
];
function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
function problem(detail: string) {
  return json(
    { code: "fixture_failure", title: "Nicht verfügbar", detail },
    503,
  );
}
Bun.serve({
  port: 18141,
  hostname: "0.0.0.0",
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__fixture" && request.method === "POST") {
      const next = await request.json();
      configureLearning(next);
      mode = next.mode || "connected";
      if ("siteUrl" in next) configuredSite = next.siteUrl;
      requests = [];
      return json({ mode });
    }
    if (url.pathname === "/__fixture/requests") return json(requests);
    if (url.pathname.startsWith("/api/"))
      requests.push(`${request.method} ${url.pathname}`);
    const learning = await learningResponse(request, url);
    if (learning) return learning;
    const resource = await fileResponse(url.pathname);
    if (resource) return resource;
    const imageCourse = url.pathname.match(
      /^\/api\/providers\/moodle\/courses\/(\d+)\/image$/,
    );
    if (imageCourse) {
      const id = Number(imageCourse[1]);
      return id === 43
        ? new Response("Missing synthetic cover", { status: 404 })
        : new Response(syntheticCourseImage(id), {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "private, max-age=300",
            },
          });
    }
    if (url.pathname === "/api/status")
      return json({
        app: "study-space",
        version: "fixture",
        commit: "synthetic",
        hostname: "os-pc",
        publicUrl: origin,
        database: "ready",
      });
    if (url.pathname === "/api/settings") {
      if (request.method === "PUT")
        displayName = (await request.json()).displayName;
      return json({ displayName, locale: "de" });
    }
    if (url.pathname === "/api/config") {
      if (mode === "config-error")
        return problem("Die Konfiguration konnte nicht geladen werden.");
      if (request.method === "PUT")
        configuredSite = new URL(
          (await request.json()).moodle.siteUrl,
        ).href.replace(/\/$/, "");
      return json({ moodle: { siteUrl: configuredSite } });
    }
    if (url.pathname === "/api/providers/moodle") {
      if (request.method === "DELETE") mode = "disconnected";
      return json(
        mode === "disconnected" ||
          mode === "config-error" ||
          mode === "browser-login"
          ? { status: "disconnected", siteUrl: null }
          : mode === "expired"
            ? { status: "expired", siteUrl: configuredSite }
            : {
                status: "connected",
                siteUrl: site,
                siteName: "Moodle · Testhochschule",
                displayName: "Testkonto",
              },
      );
    }
    if (url.pathname === "/api/providers/moodle/discover")
      return json({
        siteUrl: configuredSite,
        siteName: "Testhochschule",
        loginMode: "site-login",
        methods: mode === "browser-login" ? ["browser-sso"] : ["qr"],
        warnings: [],
      });
    if (
      url.pathname === "/api/providers/moodle/login/start" ||
      url.pathname === `/api/providers/moodle/login/${syntheticLoginId}`
    )
      return json({
        id: syntheticLoginId,
        status: mode === "connected" ? "completed" : "pending",
        method: "browser-sso",
        launchUrl: `${origin}/moodle/test-login`,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
    if (url.pathname === "/moodle/test-login") {
      if (request.method === "POST") mode = "connected";
      return new Response(
        `<!doctype html><html lang="de"><meta charset="utf-8"><title>Synthetische Moodle-Anmeldung</title><h1>Synthetische Moodle-Anmeldung</h1>${mode === "connected" ? "<p>Anmeldung simuliert. Study Space kann die Verbindung jetzt erkennen.</p>" : '<p>Nur Testdaten. Keine echte Anmeldung.</p><form method="post"><button>Anmeldung simulieren</button></form>'}</html>`,
        { headers: htmlHeaders },
      );
    }
    if (url.pathname === "/api/providers/moodle/courses")
      return mode === "course-error"
        ? problem(
            "Die Kurse konnten nicht geladen werden. Bitte erneut versuchen.",
          )
        : json(mode === "empty" ? [] : courses);
    if (/\/courses\/\d+\/contents$/.test(url.pathname))
      return mode === "content-error"
        ? problem("Die Kursinhalte konnten nicht geladen werden.")
        : json(
            mode === "empty-sections"
              ? []
              : fileSections(
                  sections,
                  Number(url.pathname.split("/")[5]),
                  site,
                ),
          );
    if (url.pathname.startsWith("/moodle/mod/"))
      return new Response(
        '<!doctype html><html lang="de"><title>Moodle-Testaktivität</title><h1>Moodle-Testaktivität</h1><p>Diese Seite enthält ausschliesslich synthetische Testdaten.</p></html>',
        { headers: htmlHeaders },
      );
    if (url.pathname.startsWith("/api/"))
      return json({ title: "Nicht verfügbar" }, 404);
    const path =
      url.pathname.startsWith("/assets/") || url.pathname === "/favicon.svg"
        ? url.pathname
        : "/index.html";
    if (path.includes("..")) return new Response("Not found", { status: 404 });
    const file = Bun.file(new URL(`../../dist${path}`, import.meta.url));
    if (
      mode === "browser-login" &&
      path === "/index.html" &&
      (await file.exists())
    ) {
      // Isolate UI state testing from browser permissions and real protocol handlers.
      return new Response(
        (await file.text()).replace(
          "<head>",
          '<head><script>Object.defineProperty(navigator,"registerProtocolHandler",{configurable:true,value:()=>{}})</script>',
        ),
        { headers: htmlHeaders },
      );
    }
    return (await file.exists())
      ? new Response(file, { headers: { "Cache-Control": "no-store" } })
      : new Response("Build the web app first", { status: 503 });
  },
});
console.log(`Synthetic Study Space fixture: ${origin}`);
