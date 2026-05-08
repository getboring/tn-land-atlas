import { useState, useEffect } from 'react'

/**
 * Graduated loading states that avoid flash on fast connections
 * and communicate progress on slow ones.
 *
 * 0–500ms:   empty (no flash)
 * 500ms–3s:  brand pulse + "Loading map…"
 * 3s–8s:     "Preparing parcel data…"
 * 8s+:       "Slow connection" + manual reload button
 */
export function MapLoadingShell() {
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0)

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 500)
    const t2 = setTimeout(() => setStage(2), 3000)
    const t3 = setTimeout(() => setStage(3), 8000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [])

  if (stage === 0) {
    return (
      <div
        className="h-full w-full bg-brand-navy"
        aria-busy="true"
        aria-label="Loading map"
      />
    )
  }

  return (
    <div
      className="h-full w-full flex flex-col items-center justify-center bg-brand-navy gap-6"
      role="status"
      aria-live="polite"
      aria-label="Loading Holston Scout"
    >
      {/* Brand mark with pulse */}
      <div className="flex flex-col items-center gap-4">
        <svg
          viewBox="0 0 20 20"
          fill="none"
          className="w-8 h-8 animate-pulse"
          style={{ animationDuration: '1.6s' }}
        >
          <path
            d="M10 2L10 14M7 4L10 2L13 4M6 14H14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-brand-copper"
          />
          <circle cx="10" cy="17" r="1.5" className="fill-brand-copper" />
        </svg>

        <span className="font-display text-brand-copper text-lg tracking-wide">
          Holston Scout
        </span>
      </div>

      {/* Status text — escalates */}
      <p className="font-mono text-brand-stone/60 text-xs tracking-wide">
        {stage === 1 && 'Loading map…'}
        {stage === 2 && 'Preparing parcel data…'}
        {stage === 3 && 'Slow connection — still loading…'}
      </p>

      {/* Reload button at stage 3 */}
      {stage === 3 && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="
            mt-2 px-5 py-2.5
            bg-brand-copper text-brand-navy
            font-sans text-sm font-semibold
            rounded-pill
            hover:bg-brand-copper-bright
            active:scale-[0.97]
            transition-all duration-fast ease-out
            min-h-[48px] min-w-[48px]
          "
        >
          Reload
        </button>
      )}
    </div>
  )
}
