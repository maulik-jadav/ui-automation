import { AlertTriangle, RefreshCw } from "lucide-react";

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900/50 dark:bg-red-950/30"
      role="alert"
    >
      <div className="flex gap-3">
        <AlertTriangle className="h-6 w-6 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
        <div className="flex-1">
          <h3 className="font-semibold text-red-900 dark:text-red-100">{title}</h3>
          {message ? (
            <p className="mt-1 text-sm text-red-800/90 dark:text-red-200/90">{message}</p>
          ) : null}
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
