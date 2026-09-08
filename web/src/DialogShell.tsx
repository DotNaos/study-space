import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { viewerButtonClass } from "./ViewerButton";

export function DialogShell({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focused = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={`fixed inset-0 m-auto max-h-[92dvh] w-[calc(100vw-2rem)] overflow-auto rounded-xl border border-border bg-bg-0 p-0 text-text shadow-2xl backdrop:bg-black/45 ${wide ? "max-w-5xl" : "max-w-lg"}`}
    >
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-bg-0 px-4 py-2.5">
        <h2
          id={titleId}
          className="min-w-0 flex-1 break-words text-sm font-medium"
        >
          {title}
        </h2>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className={viewerButtonClass}
          aria-label="Dialog schließen"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>,
    document.body,
  );
}
