// Error boundary fallback for the map subtree.
//
// Wired in App.tsx via react-error-boundary. Catches any render-time
// crash from ParcelMap and below (chunked load failures, MapLibre
// init errors, network failures while constructing the initial state)
// and renders a branded retry surface.
//
// We coerce `error` to a string defensively — react-error-boundary
// types it as `unknown` so the typescript-eslint no-unsafe-* rules
// don't fire on whatever the user-defined throw value was.

import type { FallbackProps } from 'react-error-boundary'

/**
 * The error boundary's fallback UI. `resetErrorBoundary` re-attempts
 * the boundary subtree; for chunked-load failures the consumer may
 * want to call `window.location.reload()` instead of relying on retry.
 */
export function MapErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  // react-error-boundary types `error` as `unknown` so it survives the
  // typescript-eslint `no-unsafe-*` lint rules. Coerce to a string here.
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'An unknown error occurred.'
  return (
    <div
      className="h-full w-full flex items-center justify-center bg-surface p-8"
      role="alert"
      aria-live="assertive"
    >
      <div className="max-w-sm text-center space-y-5">
        {/* Error icon */}
        <div className="mx-auto w-12 h-12 rounded-full bg-danger/10 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-danger">
            <path
              d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <h2 className="font-display text-text-primary text-xl">
          Map failed to load
        </h2>

        <p className="font-mono text-text-tertiary/60 text-xs break-all leading-relaxed max-h-24 overflow-y-auto brand-scroll">
          {message}
        </p>

        <button
          type="button"
          onClick={resetErrorBoundary}
          className="
            px-6 py-3
            bg-brand text-surface
            font-sans text-sm font-semibold
            rounded-pill
            hover:bg-brand-strong
            active:scale-[0.97]
            transition-all duration-fast ease-out
            min-h-[48px]
          "
        >
          Retry
        </button>
      </div>
    </div>
  )
}
