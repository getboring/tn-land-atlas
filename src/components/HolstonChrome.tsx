import type { ReactNode } from 'react'

interface HolstonChromeProps {
  /** Slot for search bar (future Phase 5) */
  centerSlot?: ReactNode
  /** Slot for auth button (future Phase G) */
  rightSlot?: ReactNode
  children: ReactNode
}

export function HolstonChrome({ centerSlot, rightSlot, children }: HolstonChromeProps) {
  return (
    <div className="h-dvh flex flex-col bg-brand-navy">
      {/* ── Top chrome bar ─────────────────────────────── */}
      <header
        role="banner"
        aria-label="Holston Scout navigation"
        className="
          relative z-[--z-chrome] flex-none
          h-[--spacing-chrome-mobile] sm:h-[--spacing-chrome]
          flex items-center px-4 gap-4
          bg-brand-navy-deep
          border-b border-brand-copper/20
          shadow-[--shadow-chrome]
        "
      >
        {/* Left: brand wordmark */}
        <div className="flex items-center gap-2.5 flex-none select-none">
          {/* Copper survey-stake mark */}
          <div
            className="w-5 h-5 flex items-center justify-center"
            aria-hidden="true"
          >
            <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5">
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
          </div>

          <span className="font-display text-brand-parchment text-[15px] tracking-wide leading-none">
            Holston Scout
          </span>
          <span
            className="hidden sm:inline-block w-px h-4 bg-brand-slate/40"
            aria-hidden="true"
          />
          <span className="hidden sm:inline text-brand-forest text-[10px] font-sans font-semibold uppercase tracking-[0.12em] leading-none">
            by Holston Intel
          </span>
        </div>

        {/* Center: search slot (future) */}
        {centerSlot ? (
          <div className="flex-1 flex justify-center max-w-md mx-auto">
            {centerSlot}
          </div>
        ) : (
          <div className="flex-1" />
        )}

        {/* Right: auth/action slot (future) */}
        <div className="flex-none flex items-center gap-2">
          {rightSlot}
        </div>
      </header>

      {/* ── Main content (map fills remaining space) ──── */}
      <main className="flex-1 relative z-[--z-map] overflow-hidden">
        {children}
      </main>
    </div>
  )
}
