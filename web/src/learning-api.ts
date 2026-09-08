import { useCallback, useEffect, useState } from "react";
import { api, message } from "./api";

export type SourceRef = {
  materialId: string;
  revision: string;
  blockId: string;
  page: number | null;
};
export type LearningSource = {
  materialId: string;
  revision: string;
  name: string;
};
export type LearningSection = {
  id: string;
  title: string;
  markdown: string;
  sources: SourceRef[];
};
export type LearningExercise = {
  id: string;
  title: string;
  prompt: string;
  hint: string;
  solution: string;
  origin: "generated" | "source";
  sources: SourceRef[];
};
export type LearningVersion = {
  id: string;
  createdAt: string;
  snapshotId: string;
  title: string;
  partial: boolean;
  warnings: string[];
  sections: LearningSection[];
  exercises: LearningExercise[];
  sources: LearningSource[];
};
export type VersionSummary = Pick<
  LearningVersion,
  "id" | "createdAt" | "snapshotId" | "title" | "partial"
> & { sectionCount: number; exerciseCount: number };
export type LearningJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string;
  completedSteps: number;
  totalSteps: number;
  error: string | null;
  candidateVersionId: string | null;
};
export type StudyMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "completed" | "interrupted";
};
export type LearningState = {
  courseId: number;
  activeVersionId: string | null;
  versions: VersionSummary[];
  activeVersion: LearningVersion | null;
  job: LearningJob | null;
  drafts: Record<string, string>;
  readingSectionId: string | null;
  messages: StudyMessage[];
};
export const learningPath = (courseId: number) =>
  `/api/learning/courses/${courseId}`;
export function runningJob(job?: { status: string } | null) {
  return job?.status === "queued" || job?.status === "running";
}

export function useLearningCourse(courseId: number) {
  const [state, setState] = useState<LearningState>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const value = await api<LearningState>(learningPath(courseId));
    setState(value);
    setError("");
    setLoading(false);
    return value;
  }, [courseId]);
  useEffect(() => {
    void refresh().catch((error) => {
      setError(message(error));
      setLoading(false);
    });
  }, [refresh]);
  useEffect(() => {
    if (!runningJob(state?.job)) return;
    const controller = new AbortController();
    let timer: number;
    const poll = async () => {
      try {
        const value = await api<LearningState>(learningPath(courseId), {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setState(value);
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
  }, [courseId, state?.job?.id, state?.job?.status]);
  return { state, setState, loading, error, setError, refresh };
}
export type LearningCourse = ReturnType<typeof useLearningCourse>;
