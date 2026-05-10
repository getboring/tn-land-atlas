// FootprintLibrary — list of saved footprint templates with select/new.
//
// MVP behavior:
//   - When the store is empty, the form is shown directly (no list).
//   - When at least one footprint exists, the list shows above the form
//     and the New button creates a fresh draft.
//   - Selecting an item loads it into the form for live editing.

import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FootprintProject } from '@/lib/build-fit/schemas'

interface FootprintLibraryProps {
  footprints: FootprintProject[]
  /** Currently-selected footprint id, or null when creating new. */
  selectedId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}

export function FootprintLibrary({
  footprints,
  selectedId,
  onSelect,
  onNew,
}: FootprintLibraryProps) {
  if (footprints.length === 0) {
    // Empty state — caller renders the form directly. Library renders
    // nothing here so the workspace doesn't show an empty header.
    return null
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="data-label">Footprints</div>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium bg-white/5 text-text-primary hover:bg-white/10 border border-border-default"
        >
          <Plus className="w-3 h-3" /> New
        </button>
      </div>
      <ul className="divide-y divide-border-subtle border border-border-default rounded-lg overflow-hidden">
        {footprints.map((fp) => {
          const dims =
            fp.widthFt != null && fp.lengthFt != null
              ? `${fp.widthFt} × ${fp.lengthFt} ft`
              : `${fp.footprintSqft.toLocaleString()} sqft`
          return (
            <li key={fp.id}>
              <button
                type="button"
                onClick={() => onSelect(fp.id)}
                aria-pressed={fp.id === selectedId}
                className={cn(
                  'w-full text-left px-3 py-2 min-h-[48px] transition-colors',
                  fp.id === selectedId ? 'bg-brand/15 text-text-primary' : 'hover:bg-white/5 text-text-primary',
                )}
              >
                <div className="text-sm font-medium truncate">{fp.name}</div>
                <div className="text-[11px] text-text-tertiary truncate mt-0.5 data-value">
                  {dims}
                  {fp.stories ? ` · ${fp.stories} stories` : ''}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
