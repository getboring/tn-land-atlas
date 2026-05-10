// FitResultPanel, the decision-summary card for the proposed footprint.
//
// Displays priority order per projects/buildplan2.md §Fit Panel Priority:
//   1. Fit status
//   2. Primary warning (if any)
//   3. Footprint dimensions / area
//   4. Parcel coverage
//   5. Setback / envelope status (Phase 3, placeholder for now)
//   6. Actions (Phase 1: Exit only)
//   7. Disclaimer
//
// Status states map to colors (per buildplan2 §Fit Result Panel states):
//   fits         green check
//   conflict     red warning
//   unknown      neutral gray with explanation

import { Check, AlertTriangle, Info, Save, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface FitResultDisplay {
  fitsParcel: boolean | null
  /** null when no footprint is placed yet. */
  footprintSqft: number | null
  parcelSqft: number | null
  coveragePct: number | null
  closestBoundaryFt: number | null
  warnings: string[]
}

interface FitResultPanelProps {
  result: FitResultDisplay
  /** Light copy describing the current footprint name + dims. */
  subtitle?: string | null
  /** Phase 2: persist a FitSession with the current placement. */
  onSavePlacement?: () => void
  /** Phase 2: clear user-positioned center, return to parcel centroid. */
  onResetCenter?: () => void
  /** True when the user has dragged the footprint off the default centroid. */
  centerOverridden?: boolean
  /** Brief flash after a successful Save Placement. */
  savedFlash?: boolean
}

export function FitResultPanel({
  result,
  subtitle,
  onSavePlacement,
  onResetCenter,
  centerOverridden = false,
  savedFlash = false,
}: FitResultPanelProps) {
  const { fitsParcel, footprintSqft, parcelSqft, coveragePct, closestBoundaryFt, warnings } = result
  const status = statusOf(fitsParcel, footprintSqft != null)

  return (
    <div className="space-y-3 text-xs">
      {/* 1. Status */}
      <div className="flex items-start gap-2">
        <StatusBadge status={status} />
        <div className="flex-1">
          <div className="text-sm font-semibold text-text-primary">{statusLabel(status)}</div>
          {subtitle && <div className="text-[11px] text-text-tertiary mt-0.5">{subtitle}</div>}
        </div>
      </div>

      {/* 2. Primary warning */}
      {warnings.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-warning/10 border border-warning/30">
          <AlertTriangle className="w-3.5 h-3.5 text-warning flex-none mt-0.5" />
          <div className="text-[11px] text-text-secondary">{warnings[0]}</div>
        </div>
      )}

      {/* 3. Footprint area + 4. Coverage */}
      {footprintSqft != null && (
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Footprint" value={`${Math.round(footprintSqft).toLocaleString()} sqft`} />
          <Metric
            label="Coverage"
            value={coveragePct != null ? `${coveragePct.toFixed(1)}%` : '—'}
            sub={parcelSqft != null ? `of ${Math.round(parcelSqft).toLocaleString()} sqft` : null}
          />
        </div>
      )}

      {/* 4b. Closest boundary, perpendicular geodesic distance from each
          footprint vertex to the nearest parcel ring edge. Real clearance,
          not a vertex-pair approximation. */}
      {closestBoundaryFt != null && (
        <Metric
          label="Closest boundary"
          value={`${Math.round(closestBoundaryFt).toLocaleString()} ft`}
        />
      )}

      {/* 5. Setback/envelope, Phase 3 placeholder. Keeps the panel layout
          stable so the future block lands without re-flow. */}
      <div className="px-3 py-2 rounded-lg bg-white/5 border border-border-default">
        <div className="data-label flex items-center gap-1">
          <Info className="w-3 h-3" /> Setbacks
        </div>
        <div className="text-[11px] text-text-tertiary mt-1">
          Setback envelope check arrives in the next release.
        </div>
      </div>

      {/* 6. Actions, Phase 2: Save Placement + Reset Center. */}
      {(onSavePlacement || onResetCenter) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {onSavePlacement && (
            <button
              type="button"
              onClick={onSavePlacement}
              disabled={status !== 'fits' && status !== 'conflict'}
              className={cn(
                'inline-flex items-center gap-1.5 h-10 px-3 rounded-lg text-xs font-semibold transition-colors',
                status === 'pending'
                  ? 'bg-white/5 text-text-tertiary cursor-not-allowed'
                  : savedFlash
                    ? 'bg-success/20 text-success border border-success/40'
                    : 'bg-brand text-white hover:bg-brand-strong hover:text-text-inverse',
              )}
            >
              {savedFlash ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              {savedFlash ? 'Placement saved' : 'Save placement'}
            </button>
          )}
          {onResetCenter && centerOverridden && (
            <button
              type="button"
              onClick={onResetCenter}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg text-[11px] text-text-tertiary hover:text-white hover:bg-white/10"
              title="Recenter footprint on parcel"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset center
            </button>
          )}
        </div>
      )}

      {/* 7. Disclaimer */}
      <div className="text-[10px] text-text-tertiary leading-snug pt-1 border-t border-border-subtle">
        Planning estimate only. Parcel boundaries, setbacks, zoning, slopes,
        easements, utilities, septic rules, floodplain status, and survey
        conditions must be verified with the local authority, surveyor, and
        design professional before purchase, permitting, or construction.
      </div>
    </div>
  )
}

type Status = 'fits' | 'conflict' | 'pending'

function statusOf(fitsParcel: boolean | null, hasFootprint: boolean): Status {
  if (!hasFootprint) return 'pending'
  if (fitsParcel === false) return 'conflict'
  if (fitsParcel === true) return 'fits'
  return 'pending'
}

function statusLabel(status: Status): string {
  switch (status) {
    case 'fits':
      return 'Fits parcel'
    case 'conflict':
      return 'Crosses parcel boundary'
    case 'pending':
      return 'No footprint placed yet'
  }
}

function StatusBadge({ status }: { status: Status }) {
  const cls = cn(
    'inline-flex items-center justify-center w-9 h-9 rounded-full flex-none',
    status === 'fits' && 'bg-success/15 text-success border border-success/40',
    status === 'conflict' && 'bg-danger/15 text-danger border border-danger/40',
    status === 'pending' && 'bg-white/5 text-text-tertiary border border-border-default',
  )
  return (
    <div className={cls}>
      {status === 'fits' && <Check className="w-4 h-4" />}
      {status === 'conflict' && <AlertTriangle className="w-4 h-4" />}
      {status === 'pending' && <Info className="w-4 h-4" />}
    </div>
  )
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div>
      <div className="data-label">{label}</div>
      <div className="data-value text-text-primary text-sm">{value}</div>
      {sub && <div className="text-[10px] text-text-tertiary mt-0.5">{sub}</div>}
    </div>
  )
}
