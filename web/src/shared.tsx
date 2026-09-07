import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

export function Notice({
  children,
  success = false,
}: {
  children: React.ReactNode;
  success?: boolean;
}) {
  const Icon = success ? CheckCircle2 : AlertCircle;
  return (
    <div
      role={success ? "status" : "alert"}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm leading-6 ${success ? "border-success/25 bg-success/5 text-success" : "border-danger/25 bg-danger/5 text-danger"}`}
    >
      <Icon size={18} className="mt-1 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function Loading({ label = "Wird geladen …" }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 text-sm text-text-muted"
    >
      <Loader2
        size={16}
        className="motion-safe:animate-spin"
        aria-hidden="true"
      />
      {label}
    </div>
  );
}

export const linkClass =
  "inline-flex items-center gap-2 rounded-md text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring";
