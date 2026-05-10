// FitResultPanel, the decision-summary card for the proposed footprint.
//
// Displays priority order per projects/buildplan2.md §Fit Panel Priority:
//   1. Fit status (parcel + envelope when configured)
//   2. Primary warning (if any)
//   3. Footprint dimensions / area
//   4. Parcel coverage
//   5. Setback config + envelope result (Phase 3)
//   6. Actions (Save Placement, Reset center)
//   7. Disclaimer
//
// Status states map to colors (per buildplan2 §Fit Result Panel states):
//   fits         green check
//   conflict     red warning
//   unknown      neutral gray with explanation

import { Check, AlertTriangle, Info, Save, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SetbackConfig } from '@/lib/build-fit/schemas'

export interface FitResultDisplay {
  fitsParcel: boolean | null
  /** null when no envelope is configured (mode === 'none' or manual). */
  fitsEnvelope: boolean | null
  /** null when no footprint is placed yet. */
  footprintSqft: number | null
  parcelSqft: number | null
  /** Envelope area in sqft when configured; null otherwise. */
  envelopeSqft: number | null
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
  /** Phase 3: setback configuration (none / uniform / manual). */
  setbackConfig?: SetbackConfig
  /** Phase 3: update setback configuration. */
  onSetbackConfigChange?: (next: SetbackConfig) => void
}

export function FitResultPanel({
  result,
  subtitle,
  onSavePlacement,
  onResetCenter,
  centerOverridden = false,
  savedFlash = false,
  setbackConfig,
  onSetbackConfigChange,
}: FitResultPanelProps) {
  const {
    fitsParcel,
    fitsEnvelope,
    footprintSqft,
    parcelSqft,
    envelopeSqft,
    coveragePct,
    closestBoundaryFt,
    warnings,
  } = result
  const status = statusOf(fitsParcel, fitsEnvelope, footprintSqft != null)
  const statusText = statusLabel(status, fitsEnvelope)

  return (
    <div className="space-y-3 text-xs">
      {/* 1. Status */}
      <div className="flex items-start gap-2">
        <StatusBadge status={status} />
        <div className="flex-1">
          <div className="text-sm font-semibold text-text-primary">{statusText}</div>
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

      {/* 5. Setback config + envelope result. */}
      {setbackConfig && onSetbackConfigChange && (
        <SetbackBlock
          config={setbackConfig}
          onChange={onSetbackConfigChange}
          fitsEnvelope={fitsEnvelope}
          envelopeSqft={envelopeSqft}
          parcelSqft={parcelSqft}
          hasFootprint={footprintSqft != null}
        />
      )}

      {/* 6. Actions, Phase 2: Save Placement + Reset Center. */}
      {(onSavePlacement || onResetCenter) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {onSavePlacement && (
            <button
              type="button"
              onClick={onSavePlacement}
              disabled={status === 'pending'}
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

type Status = 'fits' | 'conflict-parcel' | 'conflict-envelope' | 'pending'

function statusOf(
  fitsParcel: boolean | null,
  fitsEnvelope: boolean | null,
  hasFootprint: boolean,
): Status {
  if (!hasFootprint) return 'pending'
  if (fitsParcel === false) return 'conflict-parcel'
  if (fitsEnvelope === false) return 'conflict-envelope'
  if (fitsParcel === true) return 'fits'
  return 'pending'
}

function statusLabel(status: Status, fitsEnvelope: boolean | null): string {
  switch (status) {
    case 'fits':
      // Only claim envelope fit when an envelope was actually evaluated.
      // fitsEnvelope === null means no setback configured or manual mode
      // (which doesn't synthesize a geometry yet).
      return fitsEnvelope === true ? 'Fits parcel and setback envelope' : 'Fits parcel'
    case 'conflict-parcel':
      return 'Crosses parcel boundary'
    case 'conflict-envelope':
      return 'Inside parcel, crosses setback envelope'
    case 'pending':
      return 'No footprint placed yet'
  }
}

function StatusBadge({ status }: { status: Status }) {
  const isConflict = status === 'conflict-parcel' || status === 'conflict-envelope'
  const cls = cn(
    'inline-flex items-center justify-center w-9 h-9 rounded-full flex-none',
    status === 'fits' && 'bg-success/15 text-success border border-success/40',
    // Envelope-only conflict reads as a warning, not an error: the
    // building still fits the parcel, it just doesn't respect the setback.
    status === 'conflict-envelope' && 'bg-warning/15 text-warning border border-warning/40',
    status === 'conflict-parcel' && 'bg-danger/15 text-danger border border-danger/40',
    status === 'pending' && 'bg-white/5 text-text-tertiary border border-border-default',
  )
  return (
    <div className={cls}>
      {status === 'fits' && <Check className="w-4 h-4" />}
      {isConflict && <AlertTriangle className="w-4 h-4" />}
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

// SetbackBlock, the Phase 3 setback configuration + envelope result. Mode
// chooser at the top, mode-specific inputs below, fit-against-envelope
// metric, and the planning-estimate disclaimer.
function SetbackBlock({
  config,
  onChange,
  fitsEnvelope,
  envelopeSqft,
  parcelSqft,
  hasFootprint,
}: {
  config: SetbackConfig
  onChange: (next: SetbackConfig) => void
  fitsEnvelope: boolean | null
  envelopeSqft: number | null
  parcelSqft: number | null
  hasFootprint: boolean
}) {
  const PRESETS = [10, 15, 25] as const
  return (
    <div className="px-3 py-2 rounded-lg bg-white/5 border border-border-default space-y-2">
      <div className="data-label flex items-center gap-1">
        <Info className="w-3 h-3" /> Setbacks
      </div>
      <div className="flex flex-wrap gap-1.5">
        <ModeButton
          label="None"
          active={config.mode === 'none'}
          onClick={() => onChange({ mode: 'none' })}
        />
        <ModeButton
          label="Uniform"
          active={config.mode === 'uniform'}
          onClick={() =>
            onChange(
              config.mode === 'uniform'
                ? config
                : { mode: 'uniform', setbackFt: 15 },
            )
          }
        />
        <ModeButton
          label="Manual"
          active={config.mode === 'manual'}
          onClick={() =>
            onChange(
              config.mode === 'manual'
                ? config
                : { mode: 'manual', frontFt: null, sideFt: null, rearFt: null, notes: null },
            )
          }
        />
      </div>

      {config.mode === 'uniform' && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map((ft) => (
              <button
                key={ft}
                type="button"
                onClick={() => onChange({ mode: 'uniform', setbackFt: ft })}
                className={cn(
                  'inline-flex items-center justify-center h-8 px-2.5 rounded-md text-[11px] font-medium border transition-colors',
                  config.setbackFt === ft
                    ? 'bg-brand text-white border-brand'
                    : 'bg-white/5 text-text-primary border-border-default hover:bg-white/10',
                )}
              >
                {ft} ft
              </button>
            ))}
            <input
              type="number"
              min={0}
              step={1}
              aria-label="Custom uniform setback in feet"
              value={config.setbackFt}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n) && n >= 0)
                  onChange({ mode: 'uniform', setbackFt: n })
              }}
              className="w-20 bg-white/5 border border-border-default text-text-primary text-sm px-2 h-8 rounded-md outline-none focus:border-brand data-value"
            />
            <span className="text-[11px] text-text-tertiary">ft</span>
          </div>
          {hasFootprint && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Metric
                label="Envelope status"
                value={
                  fitsEnvelope === true
                    ? 'Fits'
                    : fitsEnvelope === false
                      ? 'Crosses'
                      : '—'
                }
              />
              <Metric
                label="Envelope area"
                value={envelopeSqft != null ? `${Math.round(envelopeSqft).toLocaleString()} sqft` : '—'}
                sub={
                  parcelSqft != null && envelopeSqft != null
                    ? `${Math.round(parcelSqft - envelopeSqft).toLocaleString()} sqft lost to setback`
                    : null
                }
              />
            </div>
          )}
        </div>
      )}

      {config.mode === 'manual' && (
        <div className="space-y-1.5">
          <div className="grid grid-cols-3 gap-2">
            <ManualField
              label="Front"
              value={config.frontFt}
              onChange={(v) => onChange({ ...config, frontFt: v })}
            />
            <ManualField
              label="Side"
              value={config.sideFt}
              onChange={(v) => onChange({ ...config, sideFt: v })}
            />
            <ManualField
              label="Rear"
              value={config.rearFt}
              onChange={(v) => onChange({ ...config, rearFt: v })}
            />
          </div>
          <textarea
            value={config.notes ?? ''}
            onChange={(e) => onChange({ ...config, notes: e.target.value || null })}
            placeholder="Notes (e.g. zoning citation, source)"
            rows={2}
            className="w-full bg-white/5 border border-border-default text-text-primary text-base sm:text-sm px-3 py-1.5 rounded-md outline-none focus:border-brand placeholder:text-text-tertiary resize-none"
          />
          <div className="text-[10px] text-text-tertiary leading-snug">
            Manual setbacks need front / side / rear edge classification to
            draw an envelope. Values are recorded; the envelope draw arrives
            with the Phase 6 true-envelope engine.
          </div>
        </div>
      )}

      {config.mode !== 'none' && (
        <div className="text-[10px] text-text-tertiary leading-snug pt-1 border-t border-border-subtle">
          Planning estimate. Local zoning may require front / side / rear
          specific setbacks and Turf buffer rounds inset corners; verify
          with the applicable code before use.
        </div>
      )}
    </div>
  )
}

function ModeButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center h-8 px-3 rounded-md text-[11px] font-medium border transition-colors',
        active
          ? 'bg-brand text-white border-brand'
          : 'bg-white/5 text-text-primary border-border-default hover:bg-white/10',
      )}
    >
      {label}
    </button>
  )
}

function ManualField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
}) {
  return (
    <label className="block">
      <div className="data-label">{label} (ft)</div>
      <input
        type="number"
        min={0}
        step={1}
        aria-label={`${label} setback in feet`}
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') {
            onChange(null)
            return
          }
          const n = Number(raw)
          if (Number.isFinite(n) && n >= 0) onChange(n)
        }}
        className="w-full bg-white/5 border border-border-default text-text-primary text-base sm:text-sm px-2 h-8 rounded-md outline-none focus:border-brand data-value"
      />
    </label>
  )
}
