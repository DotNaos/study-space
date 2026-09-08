import type { ReactNode } from "react";

export const viewerButtonClass =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-md text-text transition-colors hover:bg-bg-1 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

export function ViewerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={viewerButtonClass}
    >
      {children}
    </button>
  );
}
