import { useEffect, useState } from "react";
import { api, message } from "./api";
import type { Activity } from "./activity";

export function useActivity(courseId?: number, moduleId?: number) {
  const [activity, setActivity] = useState<Activity>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!courseId || !moduleId) { setError("Ungültige Aktivität."); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(""); setActivity(undefined);
    void api<Activity>(`/api/providers/moodle/courses/${courseId}/modules/${moduleId}`, controller.signal)
      .then(value => { if (!controller.signal.aborted) setActivity(value); })
      .catch(error => { if (!controller.signal.aborted) setError(message(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [courseId, moduleId, revision]);
  return { activity, error, loading, revision, reload: () => setRevision(value => value + 1) };
}
