// BuildFitWorkspace — fit mode shell. Lazy-loaded from ParcelMap.tsx via
// React.lazy so the Turf + Zod + workspace bundle only ships when the user
// clicks "Test Building Fit." This is a default export to play nicely with
// React.lazy.
//
// Lifecycle:
//   - Mount: install fit-* layers + sources via map-layers helpers.
//   - On footprint change: rectangle + fit math + setData updates.
//   - Unmount: clear fit sources (layers stay installed; cheap to re-enter).
//   - On parcel-clear in the host: ParcelMap closes us via onClose.
//
// What this file does NOT do (per Day 3 scope):
//   - No setbacks (Phase 3).
//   - No drag/rotate handles (Phase 2; numeric rotation is supported).
//   - No "Save placement" — saving the FitSession is Phase 4.
//   - No Send-to-Builder.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ParcelFeature } from '@/lib/arcgis'
import {
  installFitLayers,
  updateFitLayers,
  clearFitLayers,
  type FitMapTarget,
} from '@/lib/build-fit/map-layers'
import {
  PolygonOrMultiSchema,
  type FootprintProject,
  type Polygon,
  type PolygonOrMulti,
} from '@/lib/build-fit/schemas'
import {
  rectangleFromDimensions,
  footprintAreaSqft,
  parcelAreaSqft,
  coveragePct,
  fitsWithinParcel,
  closestBoundaryFt,
  normalizeParcel,
  defaultFootprintCenter,
} from '@/lib/build-fit/geometry'
import { useFootprints, upsertFootprint, removeFootprint } from '@/lib/build-fit/storage'
import { FootprintLibrary } from './FootprintLibrary'
import { FootprintForm, type FootprintFormValues } from './FootprintForm'
import { FitResultPanel, type FitResultDisplay } from './FitResultPanel'

interface BuildFitWorkspaceProps {
  map: FitMapTarget
  parcel: ParcelFeature
  onClose: () => void
}

export default function BuildFitWorkspace({ map, parcel, onClose }: BuildFitWorkspaceProps) {
  // ── Validate parcel geometry at the workspace boundary ────────────────────
  // ParcelFeature.geometry is typed as Polygon, but ArcGIS occasionally
  // returns MultiPolygon. Run the geometry through Zod here so the rest of
  // the workspace operates on a properly-typed PolygonOrMulti.
  const validated = useMemo<{ ok: true; geom: PolygonOrMulti } | { ok: false; error: string }>(() => {
    const result = PolygonOrMultiSchema.safeParse(parcel.geometry)
    if (!result.success) {
      return { ok: false, error: 'Could not read this parcel’s geometry. Try selecting it again.' }
    }
    return { ok: true, geom: result.data }
  }, [parcel.geometry])

  // ── Install fit layers on mount; clear on unmount ─────────────────────────
  // Insert before parcel-corners so footprint sits visually above the
  // selected parcel fill but below the corner-node markers (rule #5 in
  // projects/buildplan2.md). beforeId falls back gracefully if the host
  // ever renames that layer.
  useEffect(() => {
    installFitLayers(map, { beforeId: 'parcel-corners' })
    return () => clearFitLayers(map)
  }, [map])

  const footprints = useFootprints()
  // explicitId tracks the user's last interaction:
  //   - string  : they picked an existing footprint by id
  //   - 'NEW'   : they clicked "New" — show a blank form
  //   - null    : initial state — auto-fall to the first footprint if any
  // Deriving selectedId via useMemo (vs storing + syncing in an effect)
  // avoids cascading renders the lint rule warns about.
  const [explicitId, setExplicitId] = useState<string | 'NEW' | null>(null)
  const selectedId = useMemo<string | null>(() => {
    if (explicitId === 'NEW') return null
    if (explicitId !== null) return explicitId
    return footprints[0]?.id ?? null
  }, [explicitId, footprints])
  const [draftValues, setDraftValues] = useState<FootprintFormValues | null>(null)

  const currentProject = useMemo<FootprintProject | null>(
    () => (selectedId ? footprints.find((f) => f.id === selectedId) ?? null : null),
    [footprints, selectedId],
  )

  // ── Compute fit on every form change ──────────────────────────────────────
  const computed = useMemo<{
    footprintGeom: Polygon | null
    result: FitResultDisplay
    subtitle: string | null
  }>(() => {
    const empty: FitResultDisplay = {
      fitsParcel: null,
      footprintSqft: null,
      parcelSqft: null,
      coveragePct: null,
      closestBoundaryFt: null,
      warnings: [],
    }
    if (!validated.ok) {
      return { footprintGeom: null, result: { ...empty, warnings: [validated.error] }, subtitle: null }
    }
    if (!draftValues || draftValues.widthFt < 1 || draftValues.lengthFt < 1) {
      return { footprintGeom: null, result: empty, subtitle: null }
    }
    // Picks the largest part for centroid (display + default placement),
    // attaches a warning if the parcel was a MultiPolygon.
    const norm = normalizeParcel(validated.geom)
    const center = defaultFootprintCenter(norm.full)
    if (!center) {
      return {
        footprintGeom: null,
        result: { ...empty, warnings: ['Parcel centroid unavailable for default placement.'] },
        subtitle: null,
      }
    }
    const geom = rectangleFromDimensions({
      center,
      widthFt: draftValues.widthFt,
      lengthFt: draftValues.lengthFt,
      rotationDeg: draftValues.rotationDeg,
    })
    const fitsParcel = fitsWithinParcel(geom, norm.full)
    const fpSqft = footprintAreaSqft(geom)
    const pSqft = parcelAreaSqft(norm.full)
    const cov = coveragePct(fpSqft, pSqft)
    const closest = closestBoundaryFt(geom, norm.full)
    const warnings: string[] = []
    if (norm.warning) warnings.push(norm.warning)
    return {
      footprintGeom: geom,
      result: {
        fitsParcel,
        footprintSqft: fpSqft,
        parcelSqft: pSqft,
        coveragePct: cov,
        closestBoundaryFt: closest,
        warnings,
      },
      subtitle: `${draftValues.widthFt} × ${draftValues.lengthFt} ft @ ${draftValues.rotationDeg}°`,
    }
  }, [validated, draftValues])

  // ── Push computed footprint to the map ────────────────────────────────────
  useEffect(() => {
    if (computed.footprintGeom) {
      updateFitLayers(map, {
        footprint: { geometry: computed.footprintGeom, valid: computed.result.fitsParcel ?? true },
      })
    } else {
      updateFitLayers(map, { footprint: null })
    }
  }, [map, computed])

  // ── Form handlers ─────────────────────────────────────────────────────────
  const onChange = useCallback((next: FootprintFormValues) => {
    setDraftValues(next)
  }, [])

  const onSave = useCallback(
    (values: FootprintFormValues) => {
      const now = new Date().toISOString()
      const id = currentProject?.id ?? cryptoRandomId()
      const project: FootprintProject = {
        id,
        name: values.name.trim(),
        kind: 'rectangle',
        widthFt: values.widthFt,
        lengthFt: values.lengthFt,
        stories: values.stories,
        footprintSqft: computed.result.footprintSqft ?? values.widthFt * values.lengthFt,
        geometry: computed.footprintGeom,
        createdFrom: 'typed-dimensions',
        notes: values.notes,
        createdAt: currentProject?.createdAt ?? now,
        updatedAt: now,
      }
      upsertFootprint(project)
      setExplicitId(id)
    },
    [currentProject, computed],
  )

  const onDelete = useCallback(() => {
    if (!currentProject) return
    removeFootprint(currentProject.id)
    setExplicitId(null)
    setDraftValues(null)
    updateFitLayers(map, { footprint: null })
  }, [currentProject, map])

  const onNew = useCallback(() => {
    setExplicitId('NEW')
    setDraftValues(null)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  // Workspace overlays the map. Side panels (desktop) or bottom sheet
  // (mobile) carry the controls; the map middle stays interactive so the
  // user can pan/zoom around the fit.
  return (
    <div
      role="dialog"
      aria-label="Building fit workspace"
      data-fit-workspace
      className="absolute inset-0 z-30 pointer-events-none"
    >
      {/* Top bar */}
      <div className="pointer-events-auto absolute top-3 left-3 right-3 sm:left-auto sm:w-[640px] flex items-center gap-2">
        <div className="flex-1 inline-flex items-center gap-2 px-3 h-10 rounded-lg bg-surface/95 backdrop-blur border border-border-default">
          <div className="data-label">Building Fit</div>
          {validated.ok ? null : <span className="text-[11px] text-danger">Geometry unreadable</span>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Exit Building Fit"
          className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-surface/95 backdrop-blur border border-border-default text-text-tertiary hover:text-white hover:bg-white/10"
          title="Exit fit mode"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Desktop: left panel (footprints + form), right panel (fit result).
          Mobile: stacked below the top bar; the bottom action bar is hidden
          by ParcelMap while fitOpen so there's room. */}
      <div
        className={cn(
          'pointer-events-auto absolute top-16 left-3 right-3 max-h-[calc(100%-5rem)]',
          'flex flex-col gap-3 overflow-y-auto brand-scroll',
          // sm+: side-by-side panels.
          'sm:flex-row sm:left-3 sm:right-3 sm:top-16 sm:bottom-3 sm:max-h-none',
        )}
      >
        {/* Library + form */}
        <div className="rounded-xl bg-surface/95 backdrop-blur border border-border-default p-3 space-y-3 sm:w-[300px] sm:flex-none">
          <FootprintLibrary
            footprints={footprints}
            selectedId={selectedId}
            onSelect={setExplicitId}
            onNew={onNew}
          />
          <FootprintForm
            // key forces FootprintForm to remount with fresh state when the
            // selection changes — avoids the prop-sync effect pattern.
            key={currentProject?.id ?? 'new'}
            initial={currentProject}
            onChange={onChange}
            onSave={onSave}
            onDelete={currentProject ? onDelete : undefined}
          />
        </div>

        {/* Map slot — flex spacer on desktop so result panel sits at far right.
            On mobile the map is naturally visible behind this panel stack. */}
        <div className="hidden sm:block flex-1" />

        {/* Fit result */}
        <div className="rounded-xl bg-surface/95 backdrop-blur border border-border-default p-3 sm:w-[320px] sm:flex-none">
          <FitResultPanel result={computed.result} subtitle={computed.subtitle} />
        </div>
      </div>
    </div>
  )
}

function cryptoRandomId(): string {
  // Phase 1 uses crypto.randomUUID for non-migrated local IDs. ULIDs come
  // when the payload migrates to D1 (see projects/buildplan2.md §IDs).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // SSR fallback — never hit in the browser path.
  return `fp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
