// BuildFitWorkspace, fit mode shell. Lazy-loaded from ParcelMap.tsx via
// React.lazy so the Turf + Zod + workspace bundle only ships when the user
// clicks "Test Building Fit." This is a default export to play nicely with
// React.lazy.
//
// Lifecycle:
//   Mount         install fit-* layers + sources via map-layers helpers
//   Form change   rectangle + fit math + setData updates
//   Drag handle   pointer/touch events on fit-footprint-handles update
//                 userCenter; the same compute path re-runs and pushes a
//                 fresh footprint geometry to the map
//   Save place    upsertFootprint + upsertSession in one click; if no
//                 footprint template exists we auto-save it first
//   Unmount       clear fit sources (layers stay installed for re-entry)
//   Parcel clear  ParcelMap closes us via onClose
//
// What this file does NOT do yet:
//   No Send-to-Builder integration (much later).
//   No live-map-in-report (Phase 5 ships SVG geometry-only; see FitReport.tsx).

// 10 MB cap on imported files. Any legitimate Holston Scout export is
// well under this (a maxed-out 10k-footprint library is ~5MB even with
// verbose geometry). A larger file is almost certainly hostile or
// accidentally-wrong, and JSON.parsing a multi-hundred-MB blob freezes
// the browser before the schema check can run. Defined at module scope
// so it's not in the workspace's render closure.
const MAX_IMPORT_BYTES = 10 * 1024 * 1024

// Phase 6: structured warning factory. Each code is a stable identifier
// tests pin on; the message is the user-facing display string.
function warn(
  severity: FitWarning['severity'],
  source: FitWarning['source'],
  code: string,
  message: string,
): FitWarning {
  return { severity, source, code, message }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Download, Upload, AlertTriangle, Check, Edit3 } from 'lucide-react'
import { ulid } from 'ulidx'
import type maplibregl from 'maplibre-gl'
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
  type BuildableEnvelope,
  type EdgeLabel,
  type EdgeLabelKind,
  type FitResult,
  type FitSession,
  type FitWarning,
  type FootprintProject,
  type Polygon,
  type PolygonOrMulti,
  type SetbackConfig,
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
  footprintLabels,
  setbackEnvelope,
  envelopeAreaSqft,
  insetPolygonRing,
  parcelEdgeLineFeatures,
  parcelEdgeLabelFeatures,
} from '@/lib/build-fit/geometry'
import {
  useFootprints,
  upsertFootprint,
  removeFootprint,
  upsertSession,
} from '@/lib/build-fit/storage'
import {
  exportStore,
  serializeProjectFile,
  exportFilename,
  importProjectFile,
  triggerDownload,
  readFileAsText,
} from '@/lib/build-fit/project-file'
import { formatFitSummary } from '@/lib/build-fit/report'
import { FootprintLibrary } from './FootprintLibrary'
import { FootprintForm, type FootprintFormValues } from './FootprintForm'
import { FitResultPanel, type FitResultDisplay } from './FitResultPanel'
import { FitReport } from './FitReport'

interface BuildFitWorkspaceProps {
  /** Real maplibregl.Map. Day 4 drag handles need `on/off/getCanvasContainer`,
   *  so the prop is the live Map instance, not the narrowed FitMapTarget.
   *  The structural cast happens at the map-layers helper boundary below. */
  map: maplibregl.Map
  parcel: ParcelFeature
  onClose: () => void
}

// One cast in one place. map-layers helpers expect FitMapTarget (the
// narrow seam). The real maplibregl.Map is structurally compatible at
// runtime; the discriminated AddLayerObject doesn't unify with our
// FitLayerSpec at compile time, so we erase the type at this boundary
// only.
function asFitTarget(m: maplibregl.Map): FitMapTarget {
  return m as unknown as FitMapTarget
}

export default function BuildFitWorkspace({ map, parcel, onClose }: BuildFitWorkspaceProps) {
  // ── Validate parcel geometry at the workspace boundary ────────────────────
  // ParcelFeature.geometry is now typed as Polygon | MultiPolygon in
  // src/lib/arcgis.ts; the Zod gate here is defense in depth (rejects
  // anything that snuck through the upstream API) and narrows from
  // ParcelGeometry to the build-fit module's own PolygonOrMulti.
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
    installFitLayers(asFitTarget(map), { beforeId: 'parcel-corners' })
    return () => clearFitLayers(asFitTarget(map))
  }, [map])

  // Escape closes fit mode. WCAG keyboard expectation for any
  // dialog-style overlay; without this, keyboard-only users have no fast
  // exit (they'd need to tab to the X button). We skip the handler when
  // the user is typing into an input/textarea so it doesn't hijack form
  // editing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      const inField =
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (inField) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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

  // ── Day 4 placement: user-positioned center ──────────────────────────────
  // null means "use parcel centroid (default)." Drag updates this.
  // Switching footprints clears it back to default, each footprint starts
  // centered. The reset is wired into the selection setter (selectFootprint)
  // below so we never sync userCenter via a watcher effect.
  const [userCenter, setUserCenter] = useState<[number, number] | null>(null)

  // Phase 3 setback config. Default: 'none'. Switching footprints does NOT
  // reset this — setback is parcel-scoped, not footprint-scoped (the user
  // probably wants the same setback to apply across different building
  // shapes on the same parcel).
  const [setbackConfig, setSetbackConfig] = useState<SetbackConfig>({ mode: 'none' })

  // Phase 6b: per-edge labels (front/side/rear/other) on the parcel's
  // largest-part exterior ring. Lives in workspace state until Save
  // Placement snapshots it into parcelSnapshot.edgeLabels. `editingEdges`
  // toggles the visible parcel-edges layer + click handler.
  const [edgeLabels, setEdgeLabels] = useState<EdgeLabel[]>([])
  const [editingEdges, setEditingEdges] = useState(false)

  // Saved-confirmation flash for the Save Placement button. Cleared by a
  // timeout scheduled from the save handler itself (not from an effect)
  // so the pattern stays out of react-hooks/set-state-in-effect.
  const [placementSavedAt, setPlacementSavedAt] = useState<number | null>(null)
  const savedFlashTimeoutRef = useRef<number | null>(null)

  // Phase 5 Copy summary flash. Same timeout-from-handler pattern as the
  // Save Placement flash above.
  const [copiedAt, setCopiedAt] = useState<number | null>(null)
  const copiedFlashTimeoutRef = useRef<number | null>(null)

  // Phase 4 export/import. Inline notice for both: success and error
  // share the same notice slot, cleared via timeout from the handler.
  const [projectNotice, setProjectNotice] = useState<
    { kind: 'ok' | 'err'; text: string } | null
  >(null)
  const projectNoticeTimeoutRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const flashProjectNotice = useCallback((kind: 'ok' | 'err', text: string) => {
    setProjectNotice({ kind, text })
    if (projectNoticeTimeoutRef.current != null) {
      window.clearTimeout(projectNoticeTimeoutRef.current)
    }
    projectNoticeTimeoutRef.current = window.setTimeout(() => {
      setProjectNotice(null)
      projectNoticeTimeoutRef.current = null
    }, kind === 'ok' ? 2500 : 5000)
  }, [])

  // Clean up any pending notice on unmount.
  useEffect(() => {
    return () => {
      if (projectNoticeTimeoutRef.current != null) {
        window.clearTimeout(projectNoticeTimeoutRef.current)
      }
    }
  }, [])

  const onExportProject = useCallback(() => {
    const file = exportStore()
    const text = serializeProjectFile(file)
    triggerDownload(exportFilename({ kind: 'store' }), text)
    const total = file.data.footprints.length + file.data.sessions.length
    flashProjectNotice(
      'ok',
      total === 0
        ? 'Exported an empty project file. Save a footprint or placement first.'
        : `Exported ${file.data.footprints.length} footprint${file.data.footprints.length === 1 ? '' : 's'} + ${file.data.sessions.length} session${file.data.sessions.length === 1 ? '' : 's'}.`,
    )
  }, [flashProjectNotice])

  const onImportClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      if (file.size > MAX_IMPORT_BYTES) {
        flashProjectNotice(
          'err',
          `File is too large (${Math.round(file.size / (1024 * 1024))} MB). Limit is 10 MB.`,
        )
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
      try {
        const text = await readFileAsText(file)
        const result = importProjectFile(text)
        if (result.ok) {
          flashProjectNotice(
            'ok',
            `Imported ${result.summary.footprints} footprint${result.summary.footprints === 1 ? '' : 's'} + ${result.summary.sessions} session${result.summary.sessions === 1 ? '' : 's'}.`,
          )
        } else {
          flashProjectNotice('err', result.error)
        }
      } catch (err) {
        flashProjectNotice(
          'err',
          err instanceof Error ? `Couldn't read file: ${err.message}` : "Couldn't read file.",
        )
      } finally {
        // Reset the input so the same file can be re-selected.
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [flashProjectNotice],
  )

  // Single setter that owns selection-side-effects: clear userCenter so a
  // new footprint starts at the parcel centroid; clear any saved-flash to
  // avoid stale confirmation on the wrong project.
  const selectFootprint = useCallback((id: string | 'NEW' | null) => {
    setExplicitId(id)
    setUserCenter(null)
    setPlacementSavedAt(null)
    if (savedFlashTimeoutRef.current != null) {
      window.clearTimeout(savedFlashTimeoutRef.current)
      savedFlashTimeoutRef.current = null
    }
  }, [])

  // ── Compute fit on every form / center change ────────────────────────────
  const computed = useMemo<{
    footprintGeom: Polygon | null
    center: [number, number] | null
    envelope: BuildableEnvelope
    result: FitResultDisplay
    subtitle: string | null
  }>(() => {
    const empty: FitResultDisplay = {
      fitsParcel: null,
      fitsEnvelope: null,
      footprintSqft: null,
      parcelSqft: null,
      envelopeSqft: null,
      coveragePct: null,
      closestBoundaryFt: null,
      warnings: [],
    }
    const emptyEnvelope: BuildableEnvelope = { mode: 'none', geometry: null, warnings: [] }

    if (!validated.ok) {
      return {
        footprintGeom: null,
        center: null,
        envelope: emptyEnvelope,
        result: {
          ...empty,
          warnings: [warn('error', 'geometry', 'parcel-geometry-invalid', validated.error)],
        },
        subtitle: null,
      }
    }
    if (!draftValues || draftValues.widthFt < 1 || draftValues.lengthFt < 1) {
      return { footprintGeom: null, center: null, envelope: emptyEnvelope, result: empty, subtitle: null }
    }
    // Picks the largest part for centroid (display + default placement),
    // attaches a warning if the parcel was a MultiPolygon.
    const norm = normalizeParcel(validated.geom)
    const fallback = defaultFootprintCenter(norm.full)
    const center = userCenter ?? fallback
    if (!center) {
      return {
        footprintGeom: null,
        center: null,
        envelope: emptyEnvelope,
        result: {
          ...empty,
          warnings: [
            warn(
              'warning',
              'geometry',
              'centroid-unavailable',
              'Parcel centroid unavailable for default placement.',
            ),
          ],
        },
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
    const warnings: FitWarning[] = []
    if (norm.warning) {
      warnings.push(warn('info', 'geometry', 'multipolygon-largest', norm.warning))
    }

    // Setback envelope. Uniform mode is the only one with a runtime
    // implementation; manual mode requires front/side/rear edge
    // classification (Phase 6 work) so the UI accepts inputs but we don't
    // synthesize an envelope from them.
    let envelope: BuildableEnvelope = emptyEnvelope
    let fitsEnvelope: boolean | null = null
    let envSqft: number | null = null
    if (setbackConfig.mode === 'uniform' && setbackConfig.setbackFt > 0) {
      const envGeom = setbackEnvelope(norm.full, setbackConfig.setbackFt)
      if (envGeom) {
        envelope = {
          mode: 'uniform',
          geometry: envGeom,
          warnings: [
            warn(
              'warning',
              'setback',
              'uniform-approximation',
              'Uniform setback approximation. Local zoning may require different front / side / rear values; verify with code.',
            ),
          ],
        }
        fitsEnvelope = fitsWithinParcel(geom, envGeom)
        envSqft = envelopeAreaSqft(envGeom)
      } else {
        envelope = {
          mode: 'uniform',
          geometry: null,
          warnings: [
            warn(
              'warning',
              'setback',
              'envelope-collapsed',
              `Setback of ${setbackConfig.setbackFt} ft leaves no buildable area on this parcel.`,
            ),
          ],
        }
        fitsEnvelope = false
      }
      for (const w of envelope.warnings) warnings.push(w)
    } else if (setbackConfig.mode === 'manual') {
      // Phase 6c: per-edge inset wired to the 6b edge labels.
      // Each edge gets the foot distance corresponding to its label:
      //   front -> frontFt, side -> sideFt, rear -> rearFt, other -> 0.
      // Unlabeled edges get 0 too — i.e. they're treated as "no zoning
      // constraint on this side." We emit a warning when there are
      // unlabeled edges so the user knows the envelope is incomplete.
      const ring = norm.largest.coordinates[0]
      const edgeCount = ring ? Math.max(0, ring.length - 1) : 0
      if (edgeCount > 0 && ring) {
        const labelByEdge = new Map<number, EdgeLabelKind>()
        for (const e of edgeLabels) labelByEdge.set(e.edgeIndex, e.label)
        const distances: number[] = []
        let unlabeledCount = 0
        let otherCount = 0
        for (let i = 0; i < edgeCount; i++) {
          const label = labelByEdge.get(i)
          if (!label) {
            unlabeledCount++
            distances.push(0)
          } else if (label === 'front') {
            distances.push(setbackConfig.frontFt ?? 0)
          } else if (label === 'side') {
            distances.push(setbackConfig.sideFt ?? 0)
          } else if (label === 'rear') {
            distances.push(setbackConfig.rearFt ?? 0)
          } else {
            // 'other' — explicitly non-zoning. No setback applied.
            otherCount++
            distances.push(0)
          }
        }
        const allZero = distances.every((d) => d === 0)
        let envGeom: PolygonOrMulti | null = null
        if (!allZero) {
          const inset = insetPolygonRing(ring, distances)
          if (inset && inset.length >= 4) {
            envGeom = { type: 'Polygon', coordinates: [inset] }
          }
        }
        const envWarnings: FitWarning[] = []
        if (unlabeledCount > 0) {
          envWarnings.push(
            warn(
              'warning',
              'edges',
              'unlabeled-edges',
              `${unlabeledCount} of ${edgeCount} parcel edges are unlabeled and have no setback applied. Label all edges for a complete envelope.`,
            ),
          )
        }
        if (otherCount > 0) {
          envWarnings.push(
            warn(
              'info',
              'edges',
              'other-edges-no-setback',
              `${otherCount} edge(s) labeled "other" — no setback applied to them.`,
            ),
          )
        }
        if (envGeom) {
          envelope = { mode: 'manual', geometry: envGeom, warnings: envWarnings }
          fitsEnvelope = fitsWithinParcel(geom, envGeom)
          envSqft = envelopeAreaSqft(envGeom)
        } else if (allZero) {
          envelope = {
            mode: 'manual',
            geometry: null,
            warnings: [
              warn(
                'info',
                'setback',
                'manual-all-zero',
                'Manual setbacks: every applied distance is 0 (no envelope to draw). Enter values and label edges.',
              ),
            ],
          }
        } else {
          envelope = {
            mode: 'manual',
            geometry: null,
            warnings: [
              warn(
                'warning',
                'setback',
                'envelope-collapsed',
                'Manual setbacks leave no buildable area on this parcel (envelope collapsed).',
              ),
            ],
          }
          fitsEnvelope = false
        }
        for (const w of envelope.warnings) warnings.push(w)
      } else {
        envelope = {
          mode: 'manual',
          geometry: null,
          warnings: [
            warn(
              'warning',
              'geometry',
              'parcel-no-exterior-ring',
              'Parcel has no usable exterior ring; cannot compute manual envelope.',
            ),
          ],
        }
        for (const w of envelope.warnings) warnings.push(w)
      }
    }

    return {
      footprintGeom: geom,
      center,
      envelope,
      result: {
        fitsParcel,
        fitsEnvelope,
        footprintSqft: fpSqft,
        parcelSqft: pSqft,
        envelopeSqft: envSqft,
        coveragePct: cov,
        closestBoundaryFt: closest,
        warnings,
      },
      subtitle: `${draftValues.widthFt} × ${draftValues.lengthFt} ft @ ${draftValues.rotationDeg}°`,
    }
  }, [validated, draftValues, userCenter, setbackConfig, edgeLabels])

  // ── Push computed footprint + center handle to the map ──────────────────
  useEffect(() => {
    if (computed.footprintGeom && computed.center && draftValues) {
      updateFitLayers(asFitTarget(map), {
        footprint: { geometry: computed.footprintGeom, valid: computed.result.fitsParcel ?? true },
        handles: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: computed.center },
              properties: { role: 'center' },
            },
          ],
        },
        labels: {
          type: 'FeatureCollection',
          features: footprintLabels({
            footprint: computed.footprintGeom,
            widthFt: draftValues.widthFt,
            lengthFt: draftValues.lengthFt,
          }),
        },
        envelope: computed.envelope.geometry,
      })
    } else {
      updateFitLayers(asFitTarget(map), {
        footprint: null,
        handles: null,
        labels: null,
        envelope: null,
      })
    }
  }, [map, computed, draftValues])

  // ── Phase 6b: push parcel edges + their labels to the map ──────────────
  // Visible only while editingEdges is true. Off -> clear both sources so
  // the lines and letters disappear without unmounting the layers.
  useEffect(() => {
    if (!validated.ok || !editingEdges) {
      updateFitLayers(asFitTarget(map), {
        parcelEdges: null,
        parcelEdgeLabels: null,
      })
      return
    }
    updateFitLayers(asFitTarget(map), {
      parcelEdges: {
        type: 'FeatureCollection',
        features: parcelEdgeLineFeatures(validated.geom, edgeLabels),
      },
      parcelEdgeLabels: {
        type: 'FeatureCollection',
        features: parcelEdgeLabelFeatures(validated.geom, edgeLabels),
      },
    })
  }, [map, validated, editingEdges, edgeLabels])

  // ── Phase 6b: click an edge to cycle its label ─────────────────────────
  // none -> front -> side -> rear -> other -> none. Cycles only while
  // editingEdges is true; otherwise the click is a no-op so map pan/zoom
  // works normally.
  useEffect(() => {
    if (!editingEdges) return
    const LABEL_CYCLE: (EdgeLabelKind | 'none')[] = ['none', 'front', 'side', 'rear', 'other']
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['fit-parcel-edges-hit'],
      })
      const f = features[0]
      if (!f) return
      const raw = (f.properties as { edgeIndex?: unknown } | null)?.edgeIndex
      if (typeof raw !== 'number') return
      const idx = raw
      // Stop the click from also re-selecting/clearing the parcel.
      e.preventDefault()
      setEdgeLabels((prev) => {
        const current = prev.find((l) => l.edgeIndex === idx)
        const currentLabel = (current?.label ?? 'none') as EdgeLabelKind | 'none'
        const at = LABEL_CYCLE.indexOf(currentLabel)
        const nextLabel = LABEL_CYCLE[(at + 1) % LABEL_CYCLE.length] ?? 'none'
        if (nextLabel === 'none') {
          return prev.filter((l) => l.edgeIndex !== idx)
        }
        const without = prev.filter((l) => l.edgeIndex !== idx)
        return [...without, { edgeIndex: idx, label: nextLabel as EdgeLabelKind }]
      })
    }
    map.on('click', 'fit-parcel-edges-hit', onClick)
    // Pointer cursor over edges so the affordance reads.
    const onEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const onLeave = () => {
      map.getCanvas().style.cursor = ''
    }
    map.on('mouseenter', 'fit-parcel-edges-hit', onEnter)
    map.on('mouseleave', 'fit-parcel-edges-hit', onLeave)
    return () => {
      map.off('click', 'fit-parcel-edges-hit', onClick)
      map.off('mouseenter', 'fit-parcel-edges-hit', onEnter)
      map.off('mouseleave', 'fit-parcel-edges-hit', onLeave)
      map.getCanvas().style.cursor = ''
    }
  }, [editingEdges, map])

  // ── Drag handle: move the footprint by dragging its center ──────────────
  // Real maplibregl events (not Terra Draw, which would clash with the
  // lasso/ruler instance per buildplan2 rule #7). Mouse + touch parity for
  // tablet / phone. Custom GeoJSON layer interaction, no editor library.
  const draggingRef = useRef(false)
  useEffect(() => {
    const canvas = map.getCanvasContainer()
    if (!canvas) return

    const onEnter = () => {
      if (!draggingRef.current) canvas.style.cursor = 'move'
    }
    const onLeave = () => {
      if (!draggingRef.current) canvas.style.cursor = ''
    }
    const setCenterFromEvent = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      setUserCenter([e.lngLat.lng, e.lngLat.lat])
    }
    const startDrag = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      e.preventDefault()
      draggingRef.current = true
      canvas.style.cursor = 'grabbing'
      // Disable map pan/zoom while dragging, without this, the map would
      // pan along with the cursor and the handle would never catch up.
      map.dragPan.disable()
    }
    const onMove = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (!draggingRef.current) return
      setCenterFromEvent(e)
    }
    const onEnd = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      canvas.style.cursor = ''
      map.dragPan.enable()
    }

    // Window-level fallback: if the user releases the pointer outside the
    // map (e.g. dragged off the canvas onto the chrome or browser frame),
    // MapLibre's own mouseup/touchend won't fire and dragPan would stay
    // disabled until the next map mouseup. Listen at the window so we
    // recover regardless of where the release happens.
    const onWindowEnd = () => onEnd()

    map.on('mouseenter', 'fit-footprint-handles', onEnter)
    map.on('mouseleave', 'fit-footprint-handles', onLeave)
    map.on('mousedown', 'fit-footprint-handles', startDrag)
    map.on('touchstart', 'fit-footprint-handles', startDrag)
    map.on('mousemove', onMove)
    map.on('touchmove', onMove)
    map.on('mouseup', onEnd)
    map.on('touchend', onEnd)
    window.addEventListener('mouseup', onWindowEnd)
    window.addEventListener('touchend', onWindowEnd)
    window.addEventListener('touchcancel', onWindowEnd)
    window.addEventListener('blur', onWindowEnd)

    return () => {
      map.off('mouseenter', 'fit-footprint-handles', onEnter)
      map.off('mouseleave', 'fit-footprint-handles', onLeave)
      map.off('mousedown', 'fit-footprint-handles', startDrag)
      map.off('touchstart', 'fit-footprint-handles', startDrag)
      map.off('mousemove', onMove)
      map.off('touchmove', onMove)
      map.off('mouseup', onEnd)
      map.off('touchend', onEnd)
      window.removeEventListener('mouseup', onWindowEnd)
      window.removeEventListener('touchend', onWindowEnd)
      window.removeEventListener('touchcancel', onWindowEnd)
      window.removeEventListener('blur', onWindowEnd)
      canvas.style.cursor = ''
      // Re-enable in case a drag was in flight at unmount.
      map.dragPan.enable()
    }
  }, [map])

  const onResetCenter = useCallback(() => setUserCenter(null), [])

  // ── Phase 5: print + copy summary handlers ──────────────────────────────
  // The FitReport markup is always mounted (gated by `hidden print:block`)
  // so window.print() works synchronously without a React commit pass.
  const onPrintReport = useCallback(() => {
    if (!computed.footprintGeom) return
    if (typeof window !== 'undefined') window.print()
  }, [computed.footprintGeom])

  const summarySource = useMemo(() => {
    if (!draftValues || !computed.footprintGeom) return null
    const p = parcel.properties
    return {
      parcel: {
        parcelKey: p.GISLINK ?? null,
        owner: p.OWNER ?? null,
        address: p.ADDRESS ?? null,
        county: p.COUNTYNAME ?? null,
        acres: p.CALC_ACRE ?? null,
        zoning: p.ZONING ?? null,
        appraisalDollars: p.APPRAISAL ?? null,
      },
      footprint: {
        name: draftValues.name.trim() || '(unnamed)',
        widthFt: draftValues.widthFt,
        lengthFt: draftValues.lengthFt,
        rotationDeg: draftValues.rotationDeg,
        stories: draftValues.stories,
        notes: draftValues.notes,
      },
      center: computed.center,
      setback: setbackConfig,
      envelopeSqft: computed.result.envelopeSqft,
      result: computed.result,
    }
  }, [draftValues, computed, parcel.properties, setbackConfig])

  const onCopySummary = useCallback(async () => {
    if (!summarySource) return
    const text = formatFitSummary({
      ...summarySource,
      generatedAt: new Date().toISOString(),
    })
    try {
      await navigator.clipboard.writeText(text)
      setCopiedAt(Date.now())
      if (copiedFlashTimeoutRef.current != null) {
        window.clearTimeout(copiedFlashTimeoutRef.current)
      }
      copiedFlashTimeoutRef.current = window.setTimeout(() => {
        setCopiedAt(null)
        copiedFlashTimeoutRef.current = null
      }, 1500)
    } catch {
      flashProjectNotice(
        'err',
        "Couldn't write to clipboard. Print the report and copy text manually.",
      )
    }
  }, [summarySource, flashProjectNotice])

  // Clean up the copied-flash timeout on unmount alongside the saved-flash one.
  useEffect(() => {
    return () => {
      if (copiedFlashTimeoutRef.current != null) {
        window.clearTimeout(copiedFlashTimeoutRef.current)
      }
    }
  }, [])

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
      const r = upsertFootprint(project)
      if (!r.ok) {
        flashProjectNotice(
          'err',
          r.reason === 'validation'
            ? 'Footprint failed validation. Check dimensions, stories, and notes.'
            : 'Browser storage rejected the write. Free up site storage and try again.',
        )
        return
      }
      selectFootprint(id)
    },
    [currentProject, computed, selectFootprint, flashProjectNotice],
  )

  const onDelete = useCallback(() => {
    if (!currentProject) return
    const r = removeFootprint(currentProject.id)
    if (!r.ok) {
      flashProjectNotice('err', 'Browser storage rejected the delete. Free up site storage and try again.')
      return
    }
    selectFootprint(null)
    setDraftValues(null)
    updateFitLayers(asFitTarget(map), { footprint: null })
  }, [currentProject, map, selectFootprint, flashProjectNotice])

  const onNew = useCallback(() => {
    selectFootprint('NEW')
    setDraftValues(null)
  }, [selectFootprint])

  // ── Save placement, persists the current placement on this parcel as a
  // FitSession. If the user has not yet saved a footprint template, we
  // auto-save it first so the session has a stable footprintProjectId to
  // reference. Returns silently when the math hasn't produced a geometry.
  const onSavePlacement = useCallback(() => {
    if (!computed.footprintGeom || !computed.center || !validated.ok || !draftValues) return
    if (draftValues.widthFt < 1 || draftValues.lengthFt < 1) return
    if (!draftValues.name.trim()) {
      // Save Placement auto-saves the footprint template if one doesn't
      // exist; the template requires a name. Surface that as a notice
      // instead of silently no-opping (audit finding).
      flashProjectNotice('err', 'Name the footprint before saving the placement.')
      return
    }

    const now = new Date().toISOString()

    // 1. Make sure a FootprintProject exists for this draft.
    let footprintProjectId = currentProject?.id
    if (!footprintProjectId) {
      footprintProjectId = ulid()
      const project: FootprintProject = {
        id: footprintProjectId,
        name: draftValues.name.trim(),
        kind: 'rectangle',
        widthFt: draftValues.widthFt,
        lengthFt: draftValues.lengthFt,
        rotationDeg: draftValues.rotationDeg,
        stories: draftValues.stories,
        footprintSqft: computed.result.footprintSqft ?? draftValues.widthFt * draftValues.lengthFt,
        geometry: computed.footprintGeom,
        createdFrom: 'typed-dimensions',
        notes: draftValues.notes,
        createdAt: now,
        updatedAt: now,
      }
      const r = upsertFootprint(project)
      if (!r.ok) {
        flashProjectNotice(
          'err',
          r.reason === 'validation'
            ? 'Footprint failed validation. Check dimensions, stories, and notes.'
            : 'Browser storage rejected the footprint write. Free up site storage and try again.',
        )
        return
      }
      selectFootprint(footprintProjectId)
    }

    // 2. Build the FitResult from the current display data. Status is a
    // conflict when either the parcel or the envelope is crossed.
    const inConflict =
      computed.result.fitsParcel === false || computed.result.fitsEnvelope === false
    const result: FitResult = {
      status: inConflict ? 'conflict' : 'fits',
      fitsParcel: computed.result.fitsParcel ?? false,
      fitsEnvelope: computed.result.fitsEnvelope,
      footprintSqft: computed.result.footprintSqft ?? 0,
      parcelSqft: computed.result.parcelSqft,
      coveragePct: computed.result.coveragePct,
      closestBoundaryFt: computed.result.closestBoundaryFt,
      measurementMethod: 'geodesic',
      conflicts: [],
      warnings: computed.result.warnings,
      computedAt: now,
    }

    // 3. ParcelFitSnapshot from the live ParcelFeature.
    const p = parcel.properties
    const snapshot = {
      parcelKey: p.GISLINK ?? '',
      ownerName: p.OWNER ?? null,
      address: p.ADDRESS ?? null,
      county: p.COUNTYNAME ?? null,
      acres: p.CALC_ACRE ?? null,
      zoning: p.ZONING ?? null,
      appraisalDollars: p.APPRAISAL ?? null,
      geometry: validated.geom,
      capturedAt: now,
      // Phase 6b: snapshot any edge labels the user applied during this
      // session so a saved placement is reproducible later.
      edgeLabels: edgeLabels.length > 0 ? edgeLabels : undefined,
    }
    if (!snapshot.parcelKey) {
      // Without a GISLINK we have no stable handle for the FitSession's
      // parcelKey. Real ArcGIS records always carry one; this guard only
      // fires on test fixtures or a future upstream change. Surface it as
      // a notice instead of silently dropping the click.
      flashProjectNotice(
        'err',
        'Cannot save placement: this parcel has no GISLINK reference. Try selecting it again.',
      )
      return
    }

    // 4. Persist the FitSession.
    const session: FitSession = {
      id: ulid(),
      parcelKey: snapshot.parcelKey,
      parcelSnapshot: snapshot,
      footprintProjectId,
      placement: {
        center: { lng: computed.center[0], lat: computed.center[1] },
        rotationDeg: draftValues.rotationDeg,
        widthFt: draftValues.widthFt,
        lengthFt: draftValues.lengthFt,
        geometry: computed.footprintGeom,
      },
      setbackConfig,
      envelope: computed.envelope,
      result,
      createdAt: now,
      updatedAt: now,
    }
    const r = upsertSession(session)
    if (!r.ok) {
      flashProjectNotice(
        'err',
        r.reason === 'validation'
          ? 'Placement failed validation. Check the footprint and parcel geometry.'
          : 'Browser storage rejected the placement write. Free up site storage and try again.',
      )
      return
    }
    setPlacementSavedAt(Date.now())
    if (savedFlashTimeoutRef.current != null) {
      window.clearTimeout(savedFlashTimeoutRef.current)
    }
    savedFlashTimeoutRef.current = window.setTimeout(() => {
      setPlacementSavedAt(null)
      savedFlashTimeoutRef.current = null
    }, 1500)
  }, [computed, currentProject, draftValues, parcel, validated, selectFootprint, setbackConfig, edgeLabels, flashProjectNotice])

  // Make sure a pending flash-clear can't fire after unmount.
  useEffect(() => {
    return () => {
      if (savedFlashTimeoutRef.current != null) {
        window.clearTimeout(savedFlashTimeoutRef.current)
      }
    }
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
          onClick={onExportProject}
          aria-label="Export project file"
          title="Download a .hscout.json with all saved footprints and sessions"
          className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-surface/95 backdrop-blur border border-border-default text-text-tertiary hover:text-white hover:bg-white/10"
        >
          <Download className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onImportClick}
          aria-label="Import project file"
          title="Load a .hscout.json file into the local library"
          className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-surface/95 backdrop-blur border border-border-default text-text-tertiary hover:text-white hover:bg-white/10"
        >
          <Upload className="w-4 h-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.hscout.json,application/json"
          onChange={onImportFile}
          aria-label="Project file to import"
          className="hidden"
        />
        <button
          type="button"
          onClick={() => setEditingEdges((v) => !v)}
          aria-pressed={editingEdges}
          aria-label={editingEdges ? 'Exit edge labeling' : 'Label parcel edges'}
          title={editingEdges
            ? 'Exit edge labeling'
            : 'Click parcel edges to cycle front / side / rear / other'}
          className={cn(
            'inline-flex items-center justify-center h-10 w-10 rounded-lg backdrop-blur border',
            editingEdges
              ? 'bg-brand text-white border-brand'
              : 'bg-surface/95 border-border-default text-text-tertiary hover:text-white hover:bg-white/10',
          )}
        >
          <Edit3 className="w-4 h-4" />
        </button>
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

      {/* Inline notice for import/export. Sits just under the top bar so
          it doesn't shift the panels. Auto-dismisses via handler timeout. */}
      {projectNotice && (
        <div
          role="status"
          aria-live="polite"
          data-project-notice
          className={cn(
            'pointer-events-auto absolute top-14 left-3 right-3 sm:left-auto sm:w-[640px] px-3 py-2 rounded-lg text-[11px] flex items-start gap-2',
            projectNotice.kind === 'ok'
              ? 'bg-success/15 text-success border border-success/40'
              : 'bg-danger/15 text-danger border border-danger/40',
          )}
        >
          {projectNotice.kind === 'ok' ? (
            <Check className="w-3.5 h-3.5 flex-none mt-0.5" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 flex-none mt-0.5" />
          )}
          <span className="flex-1">{projectNotice.text}</span>
        </div>
      )}

      {/* Mobile-only tab bar. Sits just above the bottom-sheet panels at
          the 60vh mark. Tab state toggles display on the single-mounted
          panels below, never unmounts them, so transient form state
          survives tab flips. */}
      <div
        role="tablist"
        aria-label="Building Fit panels"
        className="sm:hidden pointer-events-auto absolute bottom-[60vh] left-0 right-0 flex bg-surface/95 backdrop-blur border-y border-border-subtle"
      >
        <MobileTab
          label="Footprint"
          active={mobileTab === 'footprint'}
          onClick={() => setMobileTab('footprint')}
        />
        <MobileTab label="Fit" active={mobileTab === 'fit'} onClick={() => setMobileTab('fit')} />
      </div>

      {/* Footprint panel, single mount.
          Desktop (sm+): fixed-width column on the left.
          Mobile (<sm): bottom sheet, gated by tab state. */}
      <div
        className={cn(
          'pointer-events-auto absolute bg-surface/95 backdrop-blur p-3 space-y-3 overflow-y-auto brand-scroll',
          // Mobile layout (max-sm scope so it never bleeds into desktop).
          'max-sm:left-0 max-sm:right-0 max-sm:bottom-0 max-sm:max-h-[60vh] max-sm:border-t max-sm:border-border-default safe-bottom',
          // Desktop layout: side panel on the left.
          'sm:w-[300px] sm:left-3 sm:top-16 sm:bottom-3 sm:rounded-xl sm:border sm:border-border-default',
          // Tab visibility (mobile only). sm:!block always wins on desktop.
          mobileTab === 'footprint' ? 'max-sm:block' : 'max-sm:hidden',
          'sm:!block',
        )}
      >
        <FootprintLibrary
          footprints={footprints}
          selectedId={selectedId}
          onSelect={selectFootprint}
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

      {/* Fit result panel, single mount.
          Desktop (sm+): fixed-width column on the right.
          Mobile (<sm): bottom sheet, gated by tab state. */}
      <div
        className={cn(
          'pointer-events-auto absolute bg-surface/95 backdrop-blur p-3 overflow-y-auto brand-scroll',
          'max-sm:left-0 max-sm:right-0 max-sm:bottom-0 max-sm:max-h-[60vh] max-sm:border-t max-sm:border-border-default safe-bottom',
          'sm:w-[320px] sm:right-3 sm:top-16 sm:bottom-3 sm:rounded-xl sm:border sm:border-border-default',
          mobileTab === 'fit' ? 'max-sm:block' : 'max-sm:hidden',
          'sm:!block',
        )}
      >
        <FitResultPanel
          result={computed.result}
          subtitle={computed.subtitle}
          onSavePlacement={onSavePlacement}
          onResetCenter={onResetCenter}
          centerOverridden={userCenter != null}
          savedFlash={placementSavedAt != null}
          setbackConfig={setbackConfig}
          onSetbackConfigChange={setSetbackConfig}
          onPrintReport={onPrintReport}
          onCopySummary={onCopySummary}
          copiedFlash={copiedAt != null}
        />
      </div>

      {/* Phase 5: print-only fit report. Always mounted while a footprint
          is placed; hidden on screen (`hidden print:block`). The @media
          print rule in src/index.css promotes any [data-print-target] to
          the printed page, same selector as the parcel-detail handout. */}
      {validated.ok && draftValues && computed.footprintGeom && (
        <FitReport
          parcel={parcel}
          parcelGeom={validated.geom}
          footprint={{
            name: draftValues.name.trim() || '(unnamed)',
            widthFt: draftValues.widthFt,
            lengthFt: draftValues.lengthFt,
            rotationDeg: draftValues.rotationDeg,
            stories: draftValues.stories,
            notes: draftValues.notes,
          }}
          footprintGeom={computed.footprintGeom}
          center={computed.center}
          result={computed.result}
          setback={setbackConfig}
          envelopeGeom={computed.envelope.geometry}
          envelopeSqft={computed.result.envelopeSqft}
          generatedAt={new Date().toISOString()}
        />
      )}
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
