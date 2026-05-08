import type { ReactNode } from 'react'
import { SurveyCornerMark } from './SurveyCornerMark'

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
        {/* Left: brand wordmark — Survey Corner mark + Holston Scout */}
        <div className="flex items-center gap-2.5 flex-none select-none">
          <SurveyCornerMark
            size={20}
            outline="#1A2B3C"
            fill="#F5F0E6"
            accent="#B8732E"
            ariaLabel="Holston Scout"
          />

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
