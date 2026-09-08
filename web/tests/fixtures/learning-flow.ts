import type {
  LearningState,
  LearningVersion,
  SourceRef,
} from "../../src/learning-api";
import type {
  MaterialDocument,
  MaterialSnapshot,
} from "../../src/material-api";
import type { CodexConnection, CodexLogin } from "../../src/codex-api";
import { syntheticPdf } from "./course-files";
import { syntheticCourseImage } from "./course-images";

const materialId = "a".repeat(64),
  revision = "9".repeat(64),
  snapshotId = "8".repeat(64);
const sourceBase = `/api/materials/${materialId}/revisions/${revision}`;
const reference: SourceRef = {
  materialId,
  revision,
  blockId: "b-00001",
  page: 1,
};
let codexStatus: CodexConnection["status"] = "disconnected";
let login: CodexLogin | undefined;
let loginStarted = 0;
let loginDelay = 4000;
let generationDelay = 1400;
let importDelay = 1000;
let failGeneration = false;
let initialSaved = false;
let largeCourse = false;
let imported = false;
const courses = new Map<number, LearningState>();
const imports = new Map<number, MaterialSnapshot>();
const generationStarted = new Map<number, number>();
const importStarted = new Map<number, number>();
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const problem = (detail: string, status = 400) =>
  json({ detail, code: "synthetic_learning_failure" }, status);

function version(number: number): LearningVersion {
  const result: LearningVersion = {
    id: `version-${number}`,
    createdAt: new Date().toISOString(),
    snapshotId,
    title: "Funktionen verstehen und anwenden",
    partial: true,
    warnings: [
      "Die Videovorlesung wurde nicht transkribiert. Dieser Lernbereich deckt nur die erfassten Unterlagen ab.",
    ],
    sources: [
      { materialId, revision, name: "Kursübersicht_Herbstsemester_2026.pdf" },
    ],
    sections: [
      {
        id: `section-${number}-1`,
        title: "Funktionen und Mengen",
        markdown:
          "Eine **Funktion** ordnet jedem Element einer Definitionsmenge genau ein Element der Zielmenge zu.\n\nFür $f(x)=2x+1$ gilt beispielsweise $f(3)=7$.\n\n| Begriff | Bedeutung |\n| --- | --- |\n| Definitionsmenge | Zulässige Eingaben |\n| Zielmenge | Mögliche Ausgaben |",
        sources: [reference],
      },
      {
        id: `section-${number}-2`,
        title: "Zusammenhänge prüfen",
        markdown:
          "Prüfe zuerst die **Definitionsmenge**. Betrachte dann den Zusammenhang zwischen Eingabe und Ausgabe.\n\n1. Wähle einen Eingabewert.\n2. Setze ihn in die Funktionsgleichung ein.\n3. Prüfe das Ergebnis.\n\nEin Ausdruck wie $x^2$ ist für alle reellen Zahlen definiert.",
        sources: [{ ...reference, blockId: "b-00002", page: 2 }],
      },
    ],
    exercises: [
      {
        id: `exercise-${number}-1`,
        title: "Funktionswert berechnen",
        prompt:
          "Gegeben ist $f(x)=2x+1$. Bestimme $f(4)$ und erkläre deinen Rechenweg.",
        hint: "Setze für $x$ die Zahl 4 ein.",
        solution:
          "$f(4)=2\\cdot4+1=9$. Zuerst wird multipliziert, dann addiert.",
        origin: "generated",
        sources: [reference],
      },
      {
        id: `exercise-${number}-2`,
        title: "Definitionsmenge erklären",
        prompt:
          "Erkläre mit eigenen Worten, was die Definitionsmenge einer Funktion beschreibt.",
        hint: "Welche Werte darfst du einsetzen?",
        solution:
          "Die Definitionsmenge enthält alle erlaubten Eingabewerte der Funktion.",
        origin: "source",
        sources: [{ ...reference, blockId: "b-00002", page: 2 }],
      },
    ],
  };
  if (largeCourse) {
    const topics = [
      "Zellstruktur und die Aufgaben der Organellen",
      "Membrantransport und das Gleichgewicht in der Zelle",
      "Enzyme und die Regulation des Stoffwechsels",
      "Genetische Information und ihre Weitergabe",
      "Ökologische Beziehungen und biologische Vielfalt",
    ];
    result.title = "Biologie: Grundlagen und Zusammenhänge";
    result.sections = Array.from({ length: 120 }, (_, index) => ({
      ...result.sections[index % 2],
      id: `section-${number}-${index + 1}`,
      title: `${topics[index % topics.length]} · Teil ${Math.floor(index / topics.length) + 1}`,
    }));
    result.exercises = Array.from({ length: 70 }, (_, index) => ({
      ...result.exercises[index % 2],
      id: `exercise-${number}-${index + 1}`,
    }));
  }
  return result;
}
function addVersion(state: LearningState) {
  const next = version(state.versions.length + 1);
  state.versions.push({
    id: next.id,
    createdAt: next.createdAt,
    snapshotId,
    title: next.title,
    partial: next.partial,
    sectionCount: next.sections.length,
    exerciseCount: next.exercises.length,
  });
  if (!state.activeVersion) {
    state.activeVersion = next;
    state.activeVersionId = next.id;
  }
  return next;
}
function stateFor(courseId: number) {
  if (!courses.has(courseId)) {
    const state: LearningState = {
      courseId,
      activeVersionId: null,
      activeVersion: null,
      versions: [],
      job: null,
      drafts: {},
      readingSectionId: null,
      messages: [],
    };
    if (initialSaved) addVersion(state);
    courses.set(courseId, state);
  }
  const state = courses.get(courseId)!;
  const started = generationStarted.get(courseId);
  if (started && state.job?.status === "running") {
    if (Date.now() - started >= generationDelay) {
      state.job.status = failGeneration ? "failed" : "completed";
      state.job.completedSteps = failGeneration ? 1 : 3;
      state.job.error = failGeneration
        ? "Die synthetische Erstellung wurde unterbrochen. Bitte erneut versuchen."
        : null;
      if (!failGeneration) state.job.candidateVersionId = addVersion(state).id;
      generationStarted.delete(courseId);
    } else state.job.completedSteps = 1;
  }
  return state;
}
function snapshotFor(courseId: number): MaterialSnapshot {
  if (!imports.has(courseId))
    imports.set(courseId, {
      courseId,
      snapshotId: null,
      status: "not-imported",
      coverage: {
        total: 0,
        ready: 0,
        failed: 0,
        unsupported: 0,
        pending: 0,
        complete: false,
      },
      materials: [],
      job: null,
      updatedAt: null,
    });
  const snapshot = imports.get(courseId)!;
  const started = importStarted.get(courseId);
  if (imported || (started && Date.now() - started >= importDelay)) {
    snapshot.snapshotId = snapshotId;
    snapshot.status = "partial";
    snapshot.updatedAt = new Date().toISOString();
    snapshot.coverage = {
      total: 2,
      ready: 1,
      failed: 0,
      unsupported: 1,
      pending: 0,
      complete: false,
    };
    snapshot.materials = [
      {
        id: materialId,
        revision,
        name: "Kursübersicht_Herbstsemester_2026.pdf",
        kind: "file",
        mimeType: "application/pdf",
        sectionId: 1,
        sectionName: "Start und Organisation",
        moduleId: 501,
        status: "ready",
        reason: null,
        documentUrl: sourceBase,
        originalUrl: null,
        warnings: [],
      },
      {
        id: "b".repeat(64),
        revision: null,
        name: "Videovorlesung · Einführung",
        kind: "video",
        mimeType: "video/mp4",
        sectionId: 2,
        sectionName: "Woche 1",
        moduleId: 503,
        status: "unsupported",
        reason: "Videos werden in diesem Schritt nicht transkribiert.",
        documentUrl: null,
        originalUrl: null,
        warnings: [],
      },
    ];
    if (snapshot.job) {
      snapshot.job.status = "completed";
      snapshot.job.completed = 2;
      snapshot.job.finishedAt = new Date().toISOString();
    }
    importStarted.delete(courseId);
  }
  return snapshot;
}
export function configureLearning(next: Record<string, unknown>) {
  if (
    !["learning", "codex", "generationDelay", "importDelay", "loginDelay"].some(
      (key) => key in next,
    )
  )
    return;
  if (!("learning" in next)) {
    if ("codex" in next) {
      codexStatus = next.codex as CodexConnection["status"];
      login = undefined;
    }
    if (typeof next.loginDelay === "number") loginDelay = next.loginDelay;
    if (typeof next.generationDelay === "number")
      generationDelay = next.generationDelay;
    return;
  }
  courses.clear();
  imports.clear();
  generationStarted.clear();
  importStarted.clear();
  largeCourse = next.learning === "large";
  initialSaved =
    largeCourse ||
    next.learning === "saved" ||
    next.learning === "malicious" ||
    next.learning === "tex";
  imported = next.learning === "partial" || initialSaved;
  failGeneration = next.learning === "generation-error";
  codexStatus = (next.codex as CodexConnection["status"]) || "disconnected";
  generationDelay =
    typeof next.generationDelay === "number" ? next.generationDelay : 1400;
  importDelay = typeof next.importDelay === "number" ? next.importDelay : 1000;
  login = undefined;
  if (next.learning === "malicious") {
    const state = stateFor(41);
    state.activeVersion!.sections[0].markdown +=
      '\n\n<script>alert("do not run")</script>\n\n![Remote tracking image](https://example.invalid/track.png)\n\n[Untrusted action](/api/codex/logout)\n\n$\\href{https://example.invalid/track}{blocked}$';
  }
  if (next.learning === "tex") {
    const state = stateFor(41);
    state.activeVersion!.sections[0].title = "Formeln und Schreibweisen";
    state.activeVersion!.sections[0].markdown = [
      String.raw`Inline: \(x^2 + y^2 = r^2\).` +
        " Eine Hälfte ist " +
        String.raw`\(\frac{1}{2}\).`,
      String.raw`\[\frac{-b \pm \sqrt{b^2-4ac}}{2a}\]`,
      String.raw`\[
\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}
\]`,
      "Ein Codebeispiel bleibt wörtlich: `" + String.raw`\(x^2\)` + "`.",
      "```tex\n" + String.raw`\[\frac{1}{2}\]` + "\n```",
      String.raw`Auch Dollar-Formeln funktionieren: $E=mc^2$.`,
    ].join("\n\n");
  }
}
export async function learningResponse(
  request: Request,
  url: URL,
): Promise<Response | undefined> {
  const path = url.pathname;
  if (path === "/api/codex") {
    if (request.method === "DELETE") {
      codexStatus = "disconnected";
      login = undefined;
      return new Response(null, { status: 204 });
    }
    return json({
      status: codexStatus,
      ...(codexStatus === "connected"
        ? { accountLabel: "Synthetisches Testkonto" }
        : {}),
      ...(login ? { login } : {}),
    });
  }
  if (path === "/api/codex/login" && request.method === "POST") {
    if (codexStatus === "unavailable")
      return problem("Codex ist in dieser Testumgebung nicht verfügbar.", 503);
    login = {
      id: "synthetic-login",
      userCode: "TEST-ONLY",
      verificationUrl: "https://auth.openai.com/codex/device",
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      status: "pending",
    };
    loginStarted = Date.now();
    codexStatus = "pending";
    return json(login);
  }
  if (path === "/api/codex/login/synthetic-login") {
    if (!login) return problem("Keine laufende Anmeldung.", 404);
    if (request.method === "DELETE") {
      login.status = "cancelled";
      codexStatus = "disconnected";
      return new Response(null, { status: 204 });
    }
    if (Date.now() - loginStarted > loginDelay && login.status === "pending") {
      login.status = "success";
      codexStatus = "connected";
    }
    return json(login);
  }
  if (path === sourceBase) {
    const document: MaterialDocument = {
      materialId,
      revision,
      name: "Kursübersicht_Herbstsemester_2026.pdf",
      mimeType: "application/pdf",
      complete: true,
      warnings: [],
      provenance: [
        {
          engine: "synthetic-fixture",
          version: "1",
          durationMs: 5,
          resultHash: revision,
        },
      ],
      blocks: [
        {
          id: "b-00001",
          kind: "paragraph",
          text: "Eine Funktion ordnet jedem Element der Definitionsmenge genau ein Element der Zielmenge zu. Beispiel: f(x) = 2x + 1.",
          order: 1,
          page: 1,
          slide: null,
          assetId: null,
        },
        {
          id: "b-00002",
          kind: "paragraph",
          text: "Übungen und Lösungen: Die Definitionsmenge enthält alle zulässigen Eingabewerte. Setze einen Wert ein und prüfe das Ergebnis.",
          order: 2,
          page: 2,
          slide: null,
          assetId: null,
        },
      ],
      assets: [
        {
          id: "original",
          kind: "original",
          mimeType: "application/pdf",
          name: "Kursübersicht.pdf",
          url: `${sourceBase}/assets/original`,
          sha256: materialId,
          byteLength: syntheticPdf().length,
          page: null,
          slide: null,
        },
        {
          id: "page-0001",
          kind: "page-image",
          mimeType: "image/png",
          name: "Seite 1",
          url: `${sourceBase}/assets/page-0001`,
          sha256: revision,
          byteLength: 2048,
          page: 1,
          slide: null,
        },
      ],
    };
    return json(document);
  }
  if (path === `${sourceBase}/assets/original`)
    return new Response(syntheticPdf(), {
      headers: { "Content-Type": "application/pdf" },
    });
  if (path === `${sourceBase}/assets/page-0001`)
    return new Response(syntheticCourseImage(41), {
      headers: { "Content-Type": "image/png" },
    });
  const material = path.match(
    /^\/api\/materials\/courses\/(\d+)(\/import|\/jobs\/([^/]+))?$/,
  );
  if (material) {
    const courseId = Number(material[1]);
    const snapshot = snapshotFor(courseId);
    if (request.method === "POST") {
      imported = false;
      snapshot.status = "running";
      snapshot.snapshotId = null;
      snapshot.job = {
        id: "synthetic-import",
        status: "running",
        completed: 0,
        total: 2,
        createdAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
      };
      importStarted.set(courseId, Date.now());
    }
    if (request.method === "DELETE" && snapshot.job) {
      snapshot.status = "cancelled";
      snapshot.job.status = "cancelled";
      importStarted.delete(courseId);
    }
    return json(snapshot);
  }
  const course = path.match(/^\/api\/learning\/courses\/(\d+)(?:\/(.*))?$/);
  if (!course) return;
  const courseId = Number(course[1]),
    suffix = course[2] || "";
  const state = stateFor(courseId);
  if (!suffix) return json(state);
  if (suffix.startsWith("versions/"))
    return json(version(Number(suffix.split("-").at(-1)) || 1));
  if (request.method === "POST" || request.method === "PUT") {
    const input = await request.json();
    if (suffix === "generate") {
      if (input.consentToCodex !== true || codexStatus !== "connected")
        return problem("Bitte zuerst ChatGPT verbinden.", 409);
      if (!snapshotFor(courseId).snapshotId || !input.allowPartial)
        return problem(
          "Die unvollständige Materialabdeckung muss bestätigt werden.",
          409,
        );
      state.job = {
        id: "synthetic-generation",
        status: "running",
        stage: "creating",
        completedSteps: 0,
        totalSteps: 3,
        error: null,
        candidateVersionId: null,
      };
      generationStarted.set(courseId, Date.now());
      return json(state, 202);
    }
    if (suffix === "cancel" && state.job) {
      state.job.status = "cancelled";
      generationStarted.delete(courseId);
    }
    if (suffix === "activate") {
      state.activeVersion = version(
        Number(input.versionId.split("-").at(-1)) || 1,
      );
      state.activeVersionId = input.versionId;
    }
    if (suffix.startsWith("drafts/"))
      state.drafts[decodeURIComponent(suffix.slice(7))] = input.answer;
    if (suffix === "position") state.readingSectionId = input.sectionId;
    if (suffix === "chat") {
      if (input.consentToCodex !== true || codexStatus !== "connected")
        return problem("Bitte ChatGPT verbinden.", 409);
      state.messages.push({
        id: `question-${Date.now()}`,
        role: "user",
        content: input.message,
        status: "completed",
      });
      let text = "";
      let stopped = false;
      const responseText =
        "Eine Funktion ordnet **jedem Eingabewert genau einen Ausgabewert** zu. Bei $f(x)=2x+1$ ergibt die Eingabe 4 den Wert 9. Dein Lernskript bleibt dabei unverändert.";
      const responseId = `answer-${Date.now()}`;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (
            let index = 0;
            index < responseText.length && !stopped;
            index += 18
          ) {
            const delta = responseText.slice(index, index + 18);
            text += delta;
            controller.enqueue(
              new TextEncoder().encode(
                `event: delta\ndata: ${JSON.stringify({ text: delta })}\n\n`,
              ),
            );
            await Bun.sleep(180);
          }
          if (stopped) return;
          const answer = {
            id: responseId,
            role: "assistant" as const,
            content: text,
            status: "completed" as const,
          };
          state.messages.push(answer);
          controller.enqueue(
            new TextEncoder().encode(
              `event: completed\ndata: ${JSON.stringify({ message: answer })}\n\n`,
            ),
          );
          controller.close();
        },
        cancel() {
          stopped = true;
          state.messages.push({
            id: responseId,
            role: "assistant",
            content: text,
            status: "interrupted",
          });
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
        },
      });
    }
    return json(state);
  }
  return problem("Synthetischer Endpunkt nicht vorhanden.", 404);
}
