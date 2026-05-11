// Top chrome bar: brand mark + wordmark on the left, reserved slots in
// the middle and on the right, and `children` (the map) below filling
// the remaining viewport via flex-col.
//
// The chrome is one of three brand surfaces (chrome / SurveyCornerMark /
// brand tokens in index.css). Updates to the brand should flow through
// all three together — see CLAUDE.md "Brand system" for the contract.
//
// `centerSlot` / `rightSlot` are intentionally empty in production
// today; they're the planned mount points for a future global search
// input and authenticated-user menu.

import type { ReactNode } from 'react'
import { SurveyCornerMark } from './SurveyCornerMark'

interface HolstonChromeProps {
  /** Slot reserved for a future global search bar (not currently wired). */
  centerSlot?: ReactNode
  /** Slot reserved for a future auth button (not currently wired). */
  rightSlot?: ReactNode
  children: ReactNode
}

/**
 * Renders the persistent top chrome bar and lays out the rest of the
 * viewport below it. Always mount this once at the App root.
 */
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
          shadow-[0_1px_3px_rgba(2,4,10,0.4)]
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
            className="hidden sm:inline-block w-px h-4 bg-border-default/60"
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
