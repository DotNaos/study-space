import { describe, expect, test, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Synthetic credentials only. Exercise the shipped HTML boundary, not a copy
// of its callback extraction code.
const callbackUrl = "web+studyspace://token=c3ludGhldGljLXRlc3QtY2FsbGJhY2s=";
const id = "a".repeat(64);

describe("Moodle browser return privacy boundary", () => {
  for (const htmlPath of ["../index.html", "../dist/index.html"]) {
    for (const prefix of ["", `id=${id}&`]) {
      test(`${htmlPath}: scrubs ${prefix ? "legacy" : "stable"} callback before decoding or loading resources`, () => {
        const html = readFileSync(new URL(htmlPath, import.meta.url), "utf8");
        const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
        expect(script).toBeDefined();
        expect(html.indexOf("history.replaceState")).toBeLessThan(
          html.search(/<script[^>]*src=/),
        );
        expect(html.indexOf("history.replaceState")).toBeLessThan(
          html.indexOf("<link"),
        );
        let cleared = false;
        const location = {
          pathname: "/moodle-return",
          hash: `#${prefix}callback=${encodeURIComponent(callbackUrl)}`,
        };
        const target: Record<string, unknown> = {};
        runInNewContext(script!, {
          location,
          window: target,
          history: {
            replaceState: (_state: unknown, _title: string, url: string) => {
              expect(url).toBe("/moodle-return");
              location.hash = "";
              cleared = true;
            },
          },
          URLSearchParams: class extends URLSearchParams {
            constructor(value: string) {
              expect(cleared).toBe(true);
              super(value);
            }
          },
        });
        expect(location.hash).toBe("");
        expect(target.__studyMoodleReturn).toEqual({ callbackUrl });
      });
    }
  }

  test("normal page anchors are not interpreted as authentication", () => {
    const script = readFileSync(
      new URL("../index.html", import.meta.url),
      "utf8",
    ).match(/<script>([\s\S]*?)<\/script>/)![1];
    const replaceState = mock();
    const target = {};
    runInNewContext(script, {
      location: { pathname: "/", hash: "#main" },
      history: { replaceState },
      window: target,
    });
    expect(replaceState).not.toHaveBeenCalled();
    expect(target).toEqual({});
  });

  test("return is memory-only and completes once, including duplicate React effects", async () => {
    const registerProtocolHandler = mock();
    const fetchMock = mock(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );
    const originalWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    const originalNavigator = Object.getOwnPropertyDescriptor(
      globalThis,
      "navigator",
    );
    const originalFetch = globalThis.fetch;
    const target = {
      isSecureContext: true,
      location: { origin: "https://study.test" },
      __studyMoodleReturn: { callbackUrl },
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: target,
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { registerProtocolHandler },
    });
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const bridge = await import("../src/browser-login");
      expect(target.__studyMoodleReturn).toBeUndefined();
      expect(bridge.supportsBrowserLogin()).toBe(true);
      bridge.registerMoodleReturn();
      bridge.registerMoodleReturn();
      expect(registerProtocolHandler).toHaveBeenCalledTimes(2);
      expect(registerProtocolHandler).toHaveBeenCalledWith(
        "web+studyspace",
        "https://study.test/moodle-return#callback=%s",
      );
      expect(registerProtocolHandler.mock.calls[0]).toEqual(
        registerProtocolHandler.mock.calls[1],
      );
      await Promise.all([
        bridge.completeBrowserReturn(),
        bridge.completeBrowserReturn(),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [path, request] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(path).toBe("/api/providers/moodle/browser-return");
      expect(path).not.toContain("token");
      expect(request.method).toBe("POST");
      expect(JSON.parse(request.body as string)).toEqual({ callbackUrl });
      expect(request.credentials).toBe("same-origin");
      (target as { isSecureContext: boolean }).isSecureContext = false;
      expect(bridge.supportsBrowserLogin()).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalWindow)
        Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
      if (originalNavigator)
        Object.defineProperty(globalThis, "navigator", originalNavigator);
      else Reflect.deleteProperty(globalThis, "navigator");
    }
  });
});

test("Moodle form renders with null siteUrl from a disconnected API response", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { isSecureContext: false },
  });
  try {
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { MoodleLogin } = await import("../src/MoodleLogin");
    const html = renderToString(
      createElement(MoodleLogin, {
        initialUrl: null,
        onConnected: async () => {},
      }),
    );
    expect(html).toContain("Moodle-Adresse");
    expect(html).toContain('value=""');
    expect(html).toContain("Weiter");
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

describe("appearance before first paint", () => {
  for (const scenario of [
    { saved: null, systemDark: true, expected: "dark" },
    { saved: null, systemDark: false, expected: "light" },
    { saved: "dark", systemDark: false, expected: "dark" },
    { saved: "light", systemDark: true, expected: "light" },
  ]) {
    test(`saved=${scenario.saved}, systemDark=${scenario.systemDark}`, () => {
      const html = readFileSync(
        new URL("../index.html", import.meta.url),
        "utf8",
      );
      const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][1][1];
      const root = {
        dataset: {} as { theme?: string },
        style: {} as { colorScheme?: string },
      };
      const meta = { content: "" };
      runInNewContext(script, {
        localStorage: { getItem: () => scenario.saved },
        matchMedia: () => ({ matches: scenario.systemDark }),
        document: { documentElement: root, querySelector: () => meta },
      });
      expect(root.dataset.theme).toBe(scenario.expected);
      expect(root.style.colorScheme).toBe(scenario.expected);
      expect(meta.content).toBe(
        scenario.expected === "dark" ? "#111111" : "#ffffff",
      );
    });
  }
});
