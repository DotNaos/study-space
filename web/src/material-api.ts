import { useCallback, useEffect, useState } from "react";
import { api, message } from "./api";
import { runningJob } from "./learning-api";

export type MaterialCoverage = {
  total: number;
  ready: number;
  failed: number;
  unsupported: number;
  pending: number;
  complete: boolean;
};
export type MaterialEntry = {
  id: string;
  revision: string | null;
  name: string;
  kind: string;
  mimeType: string | null;
  sectionId: number;
  sectionName: string;
  moduleId: number | null;
  status: string;
  reason: string | null;
  documentUrl: string | null;
  originalUrl: string | null;
  warnings: string[];
};
export type MaterialJob = {
  id: string;
  status: string;
  completed: number;
  total: number;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
};
export type MaterialSnapshot = {
  courseId: number;
  snapshotId: string | null;
  status: string;
  coverage: MaterialCoverage;
  materials: MaterialEntry[];
  job: MaterialJob | null;
  updatedAt: string | null;
};
export type MaterialBlock = {
  id: string;
  kind: string;
  text: string;
  order: number;
  page: number | null;
  slide: number | null;
  assetId: string | null;
  bounds?: { x: number; y: number; width: number; height: number } | null;
  cells?: string[][] | null;
};
export type MaterialAsset = {
  id: string;
  kind: string;
  mimeType: string;
  name: string;
  url: string;
  sha256: string;
  byteLength: number;
  page: number | null;
  slide: number | null;
};
export type MaterialDocument = {
  materialId: string;
  revision: string;
  name: string;
  mimeType: string;
  blocks: MaterialBlock[];
  assets: MaterialAsset[];
  provenance: {
    engine: string;
    version: string;
    durationMs: number;
    resultHash: string;
  }[];
  warnings: string[];
  complete: boolean;
};
export const materialCoursePath = (id: number) =>
  `/api/materials/courses/${id}`;
export function materialDocumentPath(
  id: string,
  revision: string,
): string | undefined {
  return /^[a-f0-9]{64}$/.test(id) && /^[a-f0-9]{64}$/.test(revision)
    ? `/api/materials/${id}/revisions/${revision}`
    : undefined;
}
export function useMaterialSnapshot(courseId: number) {
  const [snapshot, setSnapshot] = useState<MaterialSnapshot>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const value = await api<MaterialSnapshot>(materialCoursePath(courseId));
    setSnapshot(value);
    setError("");
    return value;
  }, [courseId]);
  useEffect(() => {
    void refresh().catch((error) => setError(message(error)));
  }, [refresh]);
  useEffect(() => {
    if (!runningJob(snapshot?.job)) return;
    const controller = new AbortController();
    let timer: number;
    const poll = async () => {
      try {
        const value = await api<MaterialSnapshot>(
          materialCoursePath(courseId),
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setSnapshot(value);
          setError("");
        }
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
  }, [courseId, snapshot?.job?.id, snapshot?.job?.status]);
  async function importMaterials() {
    setBusy(true);
    setError("");
    try {
      setSnapshot(
        await api<MaterialSnapshot>(`${materialCoursePath(courseId)}/import`, {
          method: "POST",
        }),
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!snapshot?.job) return;
    setBusy(true);
    setError("");
    try {
      setSnapshot(
        await api<MaterialSnapshot>(
          `${materialCoursePath(courseId)}/jobs/${encodeURIComponent(snapshot.job.id)}`,
          { method: "DELETE" },
        ),
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return { snapshot, busy, error, refresh, importMaterials, cancel };
}
export type MaterialState = ReturnType<typeof useMaterialSnapshot>;
