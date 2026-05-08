import type { FallbackProps } from 'react-error-boundary'

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
      className="h-full w-full flex items-center justify-center bg-brand-navy p-8"
      role="alert"
      aria-live="assertive"
    >
      <div className="max-w-sm text-center space-y-5">
        {/* Error icon */}
        <div className="mx-auto w-12 h-12 rounded-full bg-brand-error/10 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-brand-error">
            <path
              d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <h2 className="font-display text-brand-parchment text-xl">
          Map failed to load
        </h2>

        <p className="font-mono text-brand-stone/60 text-xs break-all leading-relaxed max-h-24 overflow-y-auto brand-scroll">
          {message}
        </p>

        <button
          type="button"
          onClick={resetErrorBoundary}
          className="
            px-6 py-3
            bg-brand-copper text-brand-navy
            font-sans text-sm font-semibold
            rounded-pill
            hover:bg-brand-copper-bright
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
