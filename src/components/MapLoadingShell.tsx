// Suspense fallback for the lazy-loaded ParcelMap chunk.
//
// The four-stage escalation matches the user's mental model of "what's
// taking so long":
//
//   0..500ms     blank surface (no flicker on fast connections)
//   500ms..3s    brand pulse + "Loading map..."
//   3s..8s       "Preparing parcel data..." (suggests work, not failure)
//   8s+          "Slow connection" copy + a manual reload button
//
// The reload button is the explicit escape hatch when chunked JS gets
// wedged behind a flaky CDN.

import { useState, useEffect } from 'react'
import { SurveyCornerMark } from './SurveyCornerMark'

/**
 * Graduated loading shell used as the `<Suspense fallback>` for the
 * lazy-loaded ParcelMap chunk. Self-contained: no props.
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
        className="h-full w-full bg-surface"
        aria-busy="true"
        aria-label="Loading map"
      />
    )
  }

  return (
    <div
      className="h-full w-full flex flex-col items-center justify-center bg-surface gap-6"
      role="status"
      aria-live="polite"
      aria-label="Loading Holston Scout"
    >
      {/* Brand mark with pulse — 1.6s for the slow, atlas-like cadence
          documented in the brand motion philosophy. */}
      <div
        className="flex flex-col items-center gap-4 animate-pulse"
        style={{ animationDuration: '1.6s' }}
      >
        <SurveyCornerMark
          size={36}
          outline="#334155"
          fill="#F8FAFC"
          accent="#F59E0B"
        />
        <span className="font-display text-brand text-lg tracking-wide">
          Holston Scout
        </span>
      </div>

      {/* Status text — escalates */}
      <p className="font-mono text-text-tertiary/60 text-xs tracking-wide">
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
            bg-brand text-surface
            font-sans text-sm font-semibold
            rounded-pill
            hover:bg-brand-strong
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
