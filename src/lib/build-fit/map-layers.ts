// Build-fit map layers — install / update / clear contract.
//
// The contract a consumer (eventually BuildFitWorkspace) gets:
//
//   installFitLayers(map, { beforeId? })
//     Idempotent. Adds the fit-* sources and layers in correct z-order.
//     Calling again is a no-op. Optional beforeId controls insertion;
//     if missing or unknown to the style, layers go to the top.
//
//   updateFitLayers(map, { footprint?, envelope?, setbackLines?, conflicts?,
//                          handles?, labels? })
//     setData-only. Each undefined field is left alone; each null clears
//     to an empty FeatureCollection. Never adds/removes layers.
//
//   clearFitLayers(map)
//     Empties every fit-* source. Does NOT remove sources or layers, and
//     does NOT touch any non-fit-* source/layer.
//
//   uninstallFitLayers(map)
//     Full removal — drops layers then sources. Useful for tests; not
//     required during normal mode toggling because clearFitLayers is
//     cheaper.
//
// Rules (see AGENTS.md and projects/buildplan2.md §Fit Mode Integration):
//   - All ids are prefixed `fit-` so they cannot collide with the app's
//     parcel/contour layers.
//   - No setStyle. Visibility/data toggling only.
//   - `beforeId` is optional and degrades gracefully: if it's not present
//     in the style, layers append to the top instead of throwing.
//   - This module never reads parcel geometry directly. The caller computes
//     footprint/envelope/conflicts and passes them as GeoJSON.

import type { Polygon, MultiPolygon } from './schemas'

// ── A narrow structural type for the MapLibre methods we actually call.
// Keeps tests honest (a small mock can satisfy this) without taking a
// hard runtime dep on maplibre-gl. The real `maplibregl.Map` is structurally
// compatible.

// `getSource` returns `unknown` here so the real `maplibregl.Map`'s broader
// `Source` union (raster | vector | geojson | ...) is structurally
// compatible. We cast to a `setData`-bearing shape inside setSourceData and
// bail if the source isn't actually a GeoJSON one.
export interface FitMapTarget {
  addSource(id: string, spec: { type: 'geojson'; data: GeoJSON.FeatureCollection }): void
  getSource(id: string): unknown
  removeSource(id: string): void
  addLayer(spec: FitLayerSpec, beforeId?: string): void
  getLayer(id: string): unknown
  removeLayer(id: string): void
  getStyle?: () => { layers?: Array<{ id: string }> } | undefined
}

// MapLibre layer-spec union — paint shapes vary by layer type. We use
// `unknown`-typed paint to avoid pinning to a specific MapLibre version's
// types; the mock+test verify shape, the real Map enforces validity at runtime.
export interface FitLayerSpec {
  id: string
  type: 'fill' | 'line' | 'circle' | 'symbol'
  source: string
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
  filter?: unknown[]
}

// ── Source and layer ids (single source of truth) ─────────────────────────

export const FIT_SOURCE_IDS = {
  envelope: 'fit-envelope',
  setbackLines: 'fit-setback-lines',
  footprint: 'fit-footprint',
  handles: 'fit-footprint-handles',
  conflicts: 'fit-conflicts',
  labels: 'fit-labels',
} as const

// Layer ids in z-order (bottom -> top). Order matches projects/buildplan2.md
// §Map Layers (lines 305-330). When inserted with the same beforeId, the
// LAST installed sits on top, which is why we install in this exact order.
export const FIT_LAYER_IDS_BOTTOM_TO_TOP = [
  'fit-envelope',          // 5: buildable envelope fill — blueish wash
  'fit-setback-lines',     // 6: dashed setback offsets
  'fit-footprint-fill',    // 7: proposed structure — amber valid / red conflict
  'fit-footprint-outline', // 8: exact building edge
  'fit-footprint-handles', // 9: center / rotate / resize handles
  'fit-conflicts',         // 10: red line segments at boundary violations
  'fit-labels',            // 11: dimension and area labels
] as const

const ALL_FIT_SOURCE_IDS: readonly string[] = Object.values(FIT_SOURCE_IDS)

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

// ── Layer specs ────────────────────────────────────────────────────────────
// Brand palette (mirrors HolstonBuilder family in src/index.css):
//   brand        #F59E0B  — valid footprint
//   brand-strong #FCD34D  — footprint outline (valid)
//   danger       #F87171  — conflict / invalid footprint
//   info         #60A5FA  — buildable envelope wash
//   text-primary #F8FAFC  — handles / label fill
//   bg           #02040A  — handles / label stroke
//
// We don't import these from CSS because MapLibre paint expressions evaluate
// at GL-shader time and can't read CSS variables. They're literals here.

function envelopeLayer(): FitLayerSpec {
  return {
    id: 'fit-envelope',
    type: 'fill',
    source: FIT_SOURCE_IDS.envelope,
    paint: {
      'fill-color': '#60A5FA',
      'fill-opacity': 0.14,
      'fill-outline-color': '#60A5FA',
    },
  }
}

function setbackLinesLayer(): FitLayerSpec {
  return {
    id: 'fit-setback-lines',
    type: 'line',
    source: FIT_SOURCE_IDS.setbackLines,
    paint: {
      'line-color': '#60A5FA',
      'line-width': 1.5,
      'line-dasharray': [2, 2],
      'line-opacity': 0.7,
    },
  }
}

// Both fill and outline read from the same `fit-footprint` source.
// Each footprint Feature carries `properties.valid: boolean`; the paint
// uses a `case` expression to switch color without re-installing layers.
function footprintFillLayer(): FitLayerSpec {
  return {
    id: 'fit-footprint-fill',
    type: 'fill',
    source: FIT_SOURCE_IDS.footprint,
    paint: {
      'fill-color': [
        'case',
        ['==', ['get', 'valid'], false],
        '#F87171',
        '#F59E0B',
      ],
      'fill-opacity': 0.32,
    },
  }
}

function footprintOutlineLayer(): FitLayerSpec {
  return {
    id: 'fit-footprint-outline',
    type: 'line',
    source: FIT_SOURCE_IDS.footprint,
    paint: {
      'line-color': [
        'case',
        ['==', ['get', 'valid'], false],
        '#F87171',
        '#FCD34D',
      ],
      'line-width': 2,
    },
  }
}

function handlesLayer(): FitLayerSpec {
  return {
    id: 'fit-footprint-handles',
    type: 'circle',
    source: FIT_SOURCE_IDS.handles,
    paint: {
      'circle-radius': 6,
      'circle-color': '#F8FAFC',
      'circle-stroke-color': '#02040A',
      'circle-stroke-width': 1.5,
    },
  }
}

function conflictsLayer(): FitLayerSpec {
  return {
    id: 'fit-conflicts',
    type: 'line',
    source: FIT_SOURCE_IDS.conflicts,
    paint: {
      'line-color': '#F87171',
      'line-width': 3,
      'line-opacity': 0.95,
    },
  }
}

function labelsLayer(): FitLayerSpec {
  return {
    id: 'fit-labels',
    type: 'symbol',
    source: FIT_SOURCE_IDS.labels,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-font': ['Open Sans Regular'], // MapLibre default; safe fallback
      'text-anchor': 'center',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#F8FAFC',
      'text-halo-color': '#02040A',
      'text-halo-width': 1.2,
    },
  }
}

// ── Install / update / clear ──────────────────────────────────────────────

export interface InstallOptions {
  /**
   * Insert each fit layer immediately before this layer id. If the id is
   * missing from the current style (e.g. consumer renamed it), all fit
   * layers are appended to the top. Either path produces a sane result —
   * the fallback isn't an error.
   */
  beforeId?: string
}

export function installFitLayers(map: FitMapTarget, options: InstallOptions = {}): void {
  // Sources first — order doesn't matter for sources.
  for (const sourceId of ALL_FIT_SOURCE_IDS) {
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: 'geojson', data: EMPTY_FC })
    }
  }

  // Resolve beforeId. If the requested anchor isn't in the style, fall back
  // to undefined (which appends to the top) rather than throwing.
  const resolvedBeforeId = resolveBeforeId(map, options.beforeId)

  // Install layers bottom -> top so each subsequent layer renders on top
  // of the previous one. Same beforeId across all installs preserves the
  // intended z-order regardless of what's already in the style.
  const specs: FitLayerSpec[] = [
    envelopeLayer(),
    setbackLinesLayer(),
    footprintFillLayer(),
    footprintOutlineLayer(),
    handlesLayer(),
    conflictsLayer(),
    labelsLayer(),
  ]
  for (const spec of specs) {
    if (!map.getLayer(spec.id)) {
      map.addLayer(spec, resolvedBeforeId)
    }
  }
}

function resolveBeforeId(map: FitMapTarget, beforeId: string | undefined): string | undefined {
  if (!beforeId) return undefined
  // Quick path: if getLayer reports the layer exists, use it.
  if (map.getLayer(beforeId)) return beforeId
  // Slow path: check the full style if available. Some MapLibre versions
  // don't return non-source layers from getLayer in edge cases.
  const styleLayers = map.getStyle?.()?.layers
  if (styleLayers?.some((l) => l.id === beforeId)) return beforeId
  return undefined
}

// Update payload: every key is optional. `undefined` leaves the source as
// it is; `null` clears to an empty FeatureCollection; a value is written
// via setData. No setStyle, no addLayer, no removeLayer here.
export interface FitUpdate {
  /** The proposed building footprint. Will be wrapped as a Feature with
   *  `properties.valid: boolean` so the case-expression paint can switch
   *  amber/red. Pass null to clear. */
  footprint?: { geometry: Polygon; valid: boolean } | null
  /** The buildable envelope (after setbacks). Polygon or MultiPolygon. */
  envelope?: Polygon | MultiPolygon | null
  /** Pre-built FeatureCollection for setback dashed offsets. */
  setbackLines?: GeoJSON.FeatureCollection<GeoJSON.LineString> | null
  /** Pre-built FeatureCollection for boundary-violation segments. */
  conflicts?: GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.Polygon> | null
  /** Pre-built FeatureCollection for placement handles (center/corner pts). */
  handles?: GeoJSON.FeatureCollection<GeoJSON.Point> | null
  /** Pre-built FeatureCollection for dimension/area labels (Point + label prop). */
  labels?: GeoJSON.FeatureCollection<GeoJSON.Point> | null
}

export function updateFitLayers(map: FitMapTarget, update: FitUpdate): void {
  if (update.footprint !== undefined) {
    const data: GeoJSON.FeatureCollection =
      update.footprint === null
        ? EMPTY_FC
        : {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: update.footprint.geometry,
                properties: { valid: update.footprint.valid },
              },
            ],
          }
    setSourceData(map, FIT_SOURCE_IDS.footprint, data)
  }

  if (update.envelope !== undefined) {
    const data: GeoJSON.FeatureCollection =
      update.envelope === null
        ? EMPTY_FC
        : {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: update.envelope, properties: {} }],
          }
    setSourceData(map, FIT_SOURCE_IDS.envelope, data)
  }

  if (update.setbackLines !== undefined) {
    setSourceData(map, FIT_SOURCE_IDS.setbackLines, update.setbackLines ?? EMPTY_FC)
  }
  if (update.conflicts !== undefined) {
    setSourceData(map, FIT_SOURCE_IDS.conflicts, update.conflicts ?? EMPTY_FC)
  }
  if (update.handles !== undefined) {
    setSourceData(map, FIT_SOURCE_IDS.handles, update.handles ?? EMPTY_FC)
  }
  if (update.labels !== undefined) {
    setSourceData(map, FIT_SOURCE_IDS.labels, update.labels ?? EMPTY_FC)
  }
}

function setSourceData(map: FitMapTarget, id: string, data: GeoJSON.FeatureCollection): void {
  const src = map.getSource(id) as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined
  if (src && typeof src.setData === 'function') src.setData(data)
}

/** Empty every fit-* source. Layers stay in place. Non-fit layers untouched. */
export function clearFitLayers(map: FitMapTarget): void {
  for (const id of ALL_FIT_SOURCE_IDS) {
    setSourceData(map, id, EMPTY_FC)
  }
}

/** Full uninstall: remove layers (top -> bottom to satisfy MapLibre), then
 *  sources. Mostly for cleanup paths and tests. Normal mode toggling should
 *  prefer clearFitLayers. */
export function uninstallFitLayers(map: FitMapTarget): void {
  const reverseOrder = [...FIT_LAYER_IDS_BOTTOM_TO_TOP].reverse()
  for (const id of reverseOrder) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  for (const id of ALL_FIT_SOURCE_IDS) {
    if (map.getSource(id)) map.removeSource(id)
  }
}
