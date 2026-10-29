/** Bottom-right toast stack (success / error / info), auto-dismissed. */
import type { JSX } from 'react';

export interface Toast {
  id: string;
  kind: 'success' | 'error' | 'info';
  text: string;
}

const TOAST_STYLES: Record<Toast['kind'], string> = {
  success: 'border-emerald-500/50 bg-emerald-950/90 text-emerald-200',
  error: 'border-red-500/50 bg-red-950/90 text-red-200',
  info: 'border-zinc-600 bg-zinc-900/95 text-zinc-200',
};

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}): JSX.Element | null {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg shadow-black/40 ${TOAST_STYLES[toast.kind]}`}
        >
          <p className="min-w-0 flex-1 break-words">{toast.text}</p>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 text-xs opacity-60 transition hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
