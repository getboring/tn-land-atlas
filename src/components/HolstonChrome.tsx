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
    <div className="h-dvh flex flex-col bg-surface">
      {/* ── Top chrome bar ─────────────────────────────── */}
      <header
        role="banner"
        aria-label="Holston Scout navigation"
        className="
          relative z-[300] flex-none
          h-12 sm:h-[52px]
          flex items-center px-4 gap-4
          bg-bg
          border-b border-brand/20
          shadow-[0_1px_3px_rgba(17,29,41,0.4)]
        "
      >
        {/* Left: brand wordmark — Survey Corner mark + Holston Scout */}
        <div className="flex items-center gap-2.5 flex-none select-none">
          <SurveyCornerMark
            size={20}
            outline="#334155"
            fill="#F8FAFC"
            accent="#F59E0B"
            ariaLabel="Holston Scout"
          />

          <span className="font-display text-text-primary text-[15px] tracking-wide leading-none">
            Holston Scout
          </span>
          <span
            className="hidden sm:inline-block w-px h-4 bg-brand-slate/40"
            aria-hidden="true"
          />
          <span className="hidden sm:inline text-text-tertiary text-[10px] font-sans font-semibold uppercase tracking-[0.12em] leading-none">
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
      <main className="flex-1 relative z-0 overflow-hidden">
        {children}
      </main>
    </div>
  )
}
