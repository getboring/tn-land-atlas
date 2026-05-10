// BuildFitWorkspace, fit mode shell. Lazy-loaded from ParcelMap.tsx via
// React.lazy so the Turf + Zod + workspace bundle only ships when the user
// clicks "Test Building Fit." This is a default export to play nicely with
// React.lazy.
//
// Lifecycle:
//   Mount         install fit-* layers + sources via map-layers helpers
//   Form change   rectangle + fit math + setData updates
//   Unmount       clear fit sources (layers stay installed for re-entry)
//   Parcel clear  ParcelMap closes us via onClose
//
// What this file does NOT do (per Day 3 scope):
//   No setbacks (Phase 3).
//   No drag/rotate handles (Phase 2; numeric rotation is supported).
//   No "Save placement", saving the FitSession is Phase 4.
//   No Send-to-Builder.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { ulid } from 'ulidx'
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
  //   - 'NEW'   : they clicked "New", show a blank form
  //   - null    : initial state, auto-fall to the first footprint if any
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
      // Defense in depth: refuse to persist a typed-dimension rectangle
      // without geometry. After the FootprintForm mount-time onChange fix,
      // computed.footprintGeom is non-null whenever name+width+length are
      // valid; this guard catches edge cases where the parcel geometry
      // failed to validate (no centroid available).
      if (!computed.footprintGeom) return
      const now = new Date().toISOString()
      const id = currentProject?.id ?? ulid()
      const project: FootprintProject = {
        id,
        name: values.name.trim(),
        kind: 'rectangle',
        widthFt: values.widthFt,
        lengthFt: values.lengthFt,
        rotationDeg: values.rotationDeg,
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

  // Mobile-only tab. Desktop renders both panels side-by-side; mobile shows
  // one at a time inside a bottom sheet so the map stays visible above.
  const [mobileTab, setMobileTab] = useState<'footprint' | 'fit'>('footprint')

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

      {/* Desktop (sm+): side panels, form on the left, result on the right,
          map fills the gap. */}
      <div className="hidden sm:flex pointer-events-auto absolute top-16 left-3 right-3 bottom-3 flex-row gap-3">
        <div className="w-[300px] flex-none rounded-xl bg-surface/95 backdrop-blur border border-border-default p-3 space-y-3 overflow-y-auto brand-scroll">
          <FootprintLibrary
            footprints={footprints}
            selectedId={selectedId}
            onSelect={setExplicitId}
            onNew={onNew}
          />
          <FootprintForm
            // key remounts the form with fresh state when the user picks a
            // different footprint, avoids a prop-sync effect.
            key={currentProject?.id ?? 'new'}
            initial={currentProject}
            onChange={onChange}
            onSave={onSave}
            onDelete={currentProject ? onDelete : undefined}
          />
        </div>
        <div className="flex-1" />
        <div className="w-[320px] flex-none rounded-xl bg-surface/95 backdrop-blur border border-border-default p-3 overflow-y-auto brand-scroll">
          <FitResultPanel result={computed.result} subtitle={computed.subtitle} />
        </div>
      </div>

      {/* Mobile (<sm): bottom sheet with two tabs. Map stays visible in the
          top half of the screen so the user can pan around the parcel. The
          host's bottom action bar is hidden while fitOpen, so the sheet has
          the lower edge to itself. safe-bottom respects iOS home indicator. */}
      <div className="sm:hidden pointer-events-auto absolute bottom-0 left-0 right-0 max-h-[60vh] flex flex-col rounded-t-2xl bg-surface/95 backdrop-blur border-t border-border-default safe-bottom">
        <div role="tablist" aria-label="Building Fit panels" className="flex border-b border-border-subtle">
          <MobileTab
            label="Footprint"
            active={mobileTab === 'footprint'}
            onClick={() => setMobileTab('footprint')}
          />
          <MobileTab
            label="Fit"
            active={mobileTab === 'fit'}
            onClick={() => setMobileTab('fit')}
          />
        </div>
        <div className="flex-1 overflow-y-auto brand-scroll p-3">
          {mobileTab === 'footprint' && (
            <div className="space-y-3">
              <FootprintLibrary
                footprints={footprints}
                selectedId={selectedId}
                onSelect={setExplicitId}
                onNew={onNew}
              />
              <FootprintForm
                key={currentProject?.id ?? 'new'}
                initial={currentProject}
                onChange={onChange}
                onSave={onSave}
                onDelete={currentProject ? onDelete : undefined}
              />
            </div>
          )}
          {mobileTab === 'fit' && (
            <FitResultPanel result={computed.result} subtitle={computed.subtitle} />
          )}
        </div>
      </div>
    </div>
  )
}

function MobileTab({
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
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex-1 h-11 text-xs font-semibold uppercase tracking-wider transition-colors',
        active ? 'text-brand border-b-2 border-brand' : 'text-text-tertiary hover:text-text-primary',
      )}
    >
      {label}
    </button>
  )
}

