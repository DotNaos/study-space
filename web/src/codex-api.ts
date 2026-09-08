import { useCallback, useEffect, useState } from "react";
import { api, message } from "./api";

export type CodexLogin = {
  id: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: string;
  status: "pending" | "success" | "failed" | "cancelled" | "expired";
};
export type CodexConnection = {
  status: "disconnected" | "connected" | "pending" | "unavailable";
  accountLabel?: string;
  login?: CodexLogin;
  message?: string;
};

export function safeCodexVerificationUrl(value: string): string | undefined {
  return value === "https://auth.openai.com/codex/device" ? value : undefined;
}
export function useCodexConnection() {
  const [connection, setConnection] = useState<CodexConnection>();
  const [login, setLogin] = useState<CodexLogin>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const value = await api<CodexConnection>("/api/codex");
    setConnection(value);
    if (value.login) setLogin(value.login);
    return value;
  }, []);
  useEffect(() => {
    void refresh().catch((error) => setError(message(error)));
  }, [refresh]);
  useEffect(() => {
    if (login?.status !== "pending") return;
    const controller = new AbortController();
    let timer: number;
    const poll = async () => {
      try {
        const current = await api<CodexLogin>(
          `/api/codex/login/${encodeURIComponent(login.id)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setLogin(current);
        setError("");
        if (current.status === "success") await refresh();
      } catch (error) {
        if (!controller.signal.aborted) setError(message(error));
      }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, 1500);
    };
    timer = window.setTimeout(poll, 1500);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [login?.id, login?.status, refresh]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      const value = await api<CodexLogin>("/api/codex/login", {
        method: "POST",
      });
      setLogin(value);
      if (value.status === "success") await refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!login) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/codex/login/${encodeURIComponent(login.id)}`, {
        method: "DELETE",
      });
      setLogin(undefined);
      await refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await api("/api/codex", { method: "DELETE" });
      setLogin(undefined);
      await refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return {
    connection,
    login,
    busy,
    error,
    setError,
    start,
    cancel,
    disconnect,
    refresh,
  };
}
