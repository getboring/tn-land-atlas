import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import mlcontour from 'maplibre-contour'
import { MaplibreExportControl } from '@watergis/maplibre-gl-export'
import '@watergis/maplibre-gl-export/dist/maplibre-gl-export.css'
import { queryParcelsByBbox, searchParcels, getPropertyData, getParcelByKey, queryParcelsInPolygon } from '@/lib/api'
import type { ParcelFeature } from '@/lib/arcgis'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Search, X, Crosshair, Building2, TrendingUp, Users, Share2, Check, Mountain, Lasso, Ruler, MousePointer2, LocateFixed, Filter, Star, Copy, Map as MapIcon, Eye, Clock, Layers } from 'lucide-react'
import { toggleSaved, useIsSaved, pushRecent, useRecents, type RecentParcel } from '@/lib/storage'
import { cn, fmtMoney, fmtDate } from '@/lib/utils'
import type { PropertyData } from '@/lib/supabase-queries'
import { parsePermalink, updateAddressBar, DEFAULT_MAP_VIEW } from '@/lib/permalink'
import { createDraw, setDrawMode, lineDistanceMeters, formatDistance, type DrawMode } from '@/lib/draw'
import type { TerraDraw } from 'terra-draw'
import {
  pricePerAcre,
  formatPricePerAcre,
  yearsHeld,
  holdingTier,
  acreageTier,
  acreageTierLabel,
  saleToAppraisalRatio,
  formatRatioPercent,
  occupancy,
  outOfState,
  entityKind,
  ownerSearchTerm,
  centroid,
  formatYearsHeld,
  appleMapsUrl,
  googleMapsUrl,
  googleStreetViewUrl,
  passesFilters,
} from '@/lib/insights'

const NO_SELECTION: number = -1

type Basemap = 'satellite' | 'streets' | 'topo' | 'hybrid'

const BASEMAP_LAYERS: Record<Basemap, string[]> = {
  satellite: ['esri-imagery'],
  streets: ['osm-streets'],
  topo: ['usgs-topo'],
  hybrid: ['esri-imagery', 'esri-hybrid-labels'],
}

const ALL_BASEMAP_LAYER_IDS = ['esri-imagery', 'osm-streets', 'usgs-topo', 'esri-hybrid-labels'] as const

// Public Mapzen-on-AWS terrarium DEM tiles (no API key, free, global).
// Single shared protocol — register exactly once, then any map can use it.
const demSource = new mlcontour.DemSource({
  url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  encoding: 'terrarium',
  maxzoom: 12,
})
let demRegistered = false

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

type Bounds = [[number, number], [number, number]]

// Walks any nested geometry coordinate array (Polygon or MultiPolygon),
// emits each [lng, lat] pair into `out`. ArcGIS occasionally returns
// MultiPolygons even though our typing assumes Polygon, so we handle both
// instead of trusting the static type.
function collectCoords(node: unknown, out: number[][]): void {
  if (!Array.isArray(node)) return
  if (node.length > 0 && typeof node[0] === 'number') {
    if (node.length >= 2 && Number.isFinite(node[0]) && Number.isFinite(node[1])) {
      out.push(node as number[])
    }
    return
  }
  for (const child of node) collectCoords(child, out)
}

function featureBounds(f: ParcelFeature): Bounds | null {
  const pts: number[][] = []
  collectCoords(f.geometry.coordinates, pts)
  if (pts.length === 0) return null
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of pts) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null
  return [[minLng, minLat], [maxLng, maxLat]]
}

function unionBounds(features: ParcelFeature[]): Bounds | null {
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const f of features) {
    const b = featureBounds(f)
    if (!b) continue
    if (b[0][0] < minLng) minLng = b[0][0]
    if (b[1][0] > maxLng) maxLng = b[1][0]
    if (b[0][1] < minLat) minLat = b[0][1]
    if (b[1][1] > maxLat) maxLat = b[1][1]
  }
  if (!Number.isFinite(minLng)) return null
  return [[minLng, minLat], [maxLng, maxLat]]
}

// All three counties are always visible. The server-side validator still
// accepts a 'county' parameter for the rare case we need it, but the UI
// doesn't expose it — turning off 2 of 3 counties was never a real workflow.
const COUNTY_ALL = 'ALL' as const

// Client-side filters applied via MapLibre filter expressions on the loaded
// parcel features. No extra API hits — this is purely "narrow what's already
// rendered." Each flag is conditional and falls back to a constant `true`
// expression when off, so the combined filter is effectively no-op.
interface ParcelFilters {
  entityOnly: boolean
  outOfStateOnly: boolean
  absenteeOnly: boolean
  recentSaleOnly: boolean
  longHeldOnly: boolean
  minAcres: number | null
}

const emptyFilters: ParcelFilters = {
  entityOnly: false,
  outOfStateOnly: false,
  absenteeOnly: false,
  recentSaleOnly: false,
  longHeldOnly: false,
  minAcres: null,
}

function applyClientFilters(
  data: GeoJSON.FeatureCollection,
  f: ParcelFilters,
): GeoJSON.FeatureCollection {
  const active =
    f.entityOnly || f.outOfStateOnly || f.absenteeOnly || f.recentSaleOnly || f.longHeldOnly || (f.minAcres != null && f.minAcres > 0)
  if (!active) return data
  return {
    type: 'FeatureCollection',
    features: data.features.filter((feat) => {
      const props = (feat as ParcelFeature).properties
      return passesFilters(props, f)
    }),
  }
}

function filtersActiveCount(f: ParcelFilters): number {
  let n = 0
  if (f.entityOnly) n++
  if (f.outOfStateOnly) n++
  if (f.absenteeOnly) n++
  if (f.recentSaleOnly) n++
  if (f.longHeldOnly) n++
  if (f.minAcres != null && f.minAcres > 0) n++
  return n
}

export default function ParcelMap() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedParcel, setSelectedParcel] = useState<ParcelFeature | null>(null)
  const [enriched, setEnriched] = useState<PropertyData | null>(null)
  const [enrichLoading, setEnrichLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [parcelCount, setParcelCount] = useState(0)
  const [searchResults, setSearchResults] = useState<ParcelFeature[] | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [contoursVisible, setContoursVisible] = useState(false)
  const [basemap, setBasemap] = useState<Basemap>('satellite')
  const [layersOpen, setLayersOpen] = useState(false)
  const [drawMode, setDrawModeState] = useState<DrawMode>('idle')
  const [rulerDistance, setRulerDistance] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState<ParcelFilters>(emptyFilters)
  const drawRef = useRef<TerraDraw | null>(null)
  const geolocateRef = useRef<maplibregl.GeolocateControl | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  // Last-loaded full feature collection from the API. Filters operate on this
  // in-memory snapshot so toggling a filter is instant — no API roundtrip.
  const rawParcelsRef = useRef<GeoJSON.FeatureCollection | null>(null)
  const filtersRef = useRef<ParcelFilters>(emptyFilters)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialPermalink = useRef(parsePermalink(window.location.search))
  // Refs to the latest callbacks so the long-lived map event handlers
  // (registered once at init) always invoke the current closure.
  const loadRef = useRef<(m: maplibregl.Map) => void>(() => {})
  const selectRef = useRef<(f: ParcelFeature, m: maplibregl.Map) => void>(() => {})

  useEffect(() => {
    if (!mapContainer.current || map.current) return

    // East-TN bounding box. Mirrors functions/api/_validate.ts so the basemap
    // doesn't request tiles outside the area we care about.
    const TN_BOUNDS: [number, number, number, number] = [-90.5, 34.5, -81.5, 37.0]

    // Register the DEM addProtocol exactly once per page load.
    if (!demRegistered) {
      demSource.setupMaplibre(maplibregl)
      demRegistered = true
    }

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        name: 'Holston Scout',
        sources: {
          // Satellite (default) — Esri World Imagery.
          'esri-imagery': {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 19,
            bounds: TN_BOUNDS,
            attribution:
              'Imagery © <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics',
          },
          // Streets — OpenStreetMap raster. Crisp address labels, useful when
          // the user is reading roads/lots rather than checking ground cover.
          'osm-streets': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 19,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
          },
          // Topographic — USGS public-domain national basemap. Useful when the
          // user is sizing a site for fill/cut and wants traditional topo.
          'usgs-topo': {
            type: 'raster',
            tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 16,
            attribution: 'Map data © <a href="https://www.usgs.gov/" target="_blank" rel="noopener">USGS</a>',
          },
          // Hybrid labels — Esri reference overlay for the satellite basemap.
          // Renders place names + boundaries on a transparent tile so it
          // stacks cleanly over imagery.
          'esri-hybrid-labels': {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 19,
            attribution:
              'Labels © <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, HERE, Garmin',
          },
        },
        layers: [
          { id: 'esri-imagery', type: 'raster', source: 'esri-imagery', minzoom: 0, maxzoom: 22 },
          { id: 'osm-streets', type: 'raster', source: 'osm-streets', minzoom: 0, maxzoom: 22, layout: { visibility: 'none' } },
          { id: 'usgs-topo', type: 'raster', source: 'usgs-topo', minzoom: 0, maxzoom: 22, layout: { visibility: 'none' } },
          // Hybrid labels render last among basemap layers so they sit on top
          // of imagery but below parcels/contours/selection.
          { id: 'esri-hybrid-labels', type: 'raster', source: 'esri-hybrid-labels', minzoom: 0, maxzoom: 22, layout: { visibility: 'none' } },
        ],
      },
      center: [
        initialPermalink.current.view?.lng ?? DEFAULT_MAP_VIEW.lng,
        initialPermalink.current.view?.lat ?? DEFAULT_MAP_VIEW.lat,
      ],
      zoom: initialPermalink.current.view?.zoom ?? DEFAULT_MAP_VIEW.zoom,
      maxZoom: 19,
    })

    // Native controls go bottom-right above the attribution. The right edge
    // is reserved for the detail / search-results panel — putting native
    // controls in the right column at top creates click-through conflicts.
    // GeolocateControl: fitBoundsOptions.maxZoom defines how close it zooms
    // when the user activates "find me". Default is the source maxzoom which
    // would jam the camera all the way in; cap at 17 so the user lands near
    // their location with a useful amount of context (a few blocks visible).
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    m.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 120 }), 'bottom-left')
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      fitBoundsOptions: { maxZoom: 17, padding: 80 },
    })
    m.addControl(geolocate, 'bottom-right')
    m.addControl(new maplibregl.FullscreenControl(), 'bottom-right')
    // Export the current map view as PDF / PNG / JPG / SVG. The control adds
    // a printer icon to the cluster; users pick format + paper size.
    m.addControl(
      new MaplibreExportControl({
        DPI: 300,
        Filename: 'tn-land-atlas',
        Crosshair: true,
        PrintableArea: true,
      }),
      'bottom-right',
    )
    geolocateRef.current = geolocate

    m.on('load', () => {
      // Defensive resize so the canvas matches the post-mount flex container
      // size (HolstonChrome takes a fixed 48-52px slice off the top; the map
      // gets the remainder via flex-1).
      m.resize()
      // Contour source: vector tiles generated on-the-fly from the DEM raster.
      // multiplier 3.28084 converts meters -> feet (TN convention).
      // thresholds: at each zoom, [minor interval, major interval] in feet.
      m.addSource('contours', {
        type: 'vector',
        tiles: [
          demSource.contourProtocolUrl({
            multiplier: 3.28084,
            thresholds: {
              11: [200, 1000],
              12: [100, 500],
              13: [50, 200],
              14: [20, 100],
              15: [10, 50],
            },
            elevationKey: 'ele',
            levelKey: 'level',
            contourLayer: 'contours',
          }),
        ],
        maxzoom: 15,
        attribution:
          'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen Terrain Tiles</a> (Public Domain)',
      })

      // Major contours (level=1) thicker, minor (level=0) thinner.
      // Visibility starts off — toggled by the Topo button.
      m.addLayer({
        id: 'contour-lines',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          // Holston copper-bright — formalizes the prior rgba(255,200,120) ad-hoc
          // tone into the brand token. 0.55 alpha so contours read over imagery
          // without drowning the parcel mosaic.
          'line-color': 'rgba(245, 158, 11, 0.55)', // #FCD34D @ 55%
          'line-width': ['match', ['get', 'level'], 1, 1.4, 0.6],
        },
      })

      m.addSource('parcels', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        attribution:
          'Parcels: <a href="https://gis.johnsoncitytn.org/" target="_blank" rel="noopener">Johnson City, TN GIS</a>',
        // generateId lets us use feature-state for hover/selection later without
        // requiring a stable id on the GeoJSON itself.
        generateId: true,
      })

      // ── Branded parcel-state system (Holston Scout) ──────────────
      // Color-blind safe: every state distinguished by line-width AND
      // fill-opacity in addition to hue.
      //   default   slate @ 0.35       thin  no fill
      //   hover     copper-bright      med   copper @ 0.14
      //   selected  copper             thick copper @ 0.24 + corner nodes
      // Per-county tinting was retired earlier — the quilt of three hues
      // fought the imagery. County is in the detail panel as text.
      //
      // TODO Phase G: host PBF glyphs on R2 for Holston-branded map labels
      m.addLayer({
        id: 'parcels-fill',
        type: 'fill',
        source: 'parcels',
        // minzoom matches loadParcelsForViewport's zoom < 13 early-return.
        minzoom: 13,
        paint: {
          // Hover state lifts the fill via feature-state. Default fill is
          // ~transparent so the imagery stays the visual hero.
          'fill-color': '#F59E0B', // copper — only visible on hover
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.14,
            0,
          ],
        },
      })

      m.addLayer({
        id: 'parcels-line',
        type: 'line',
        source: 'parcels',
        minzoom: 13,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          // Default outline — slate at low alpha. Calmer than parchment
          // over aerial imagery; reads like a USGS quadrangle line.
          'line-color': '#94A3B8',
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 18, 1.6],
          'line-opacity': 0.6,
        },
      })

      // Hover preview — driven by feature-state. Lights up the outline
      // under the cursor in addition to the fill above.
      //
      // MapLibre style spec rejects feature-state in `filter` so the layer
      // paints every feature at zero opacity unless hover is true. Cost is
      // a single extra line draw call per frame at zoom >= 13.
      m.addLayer({
        id: 'parcels-hover',
        type: 'line',
        source: 'parcels',
        minzoom: 13,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#FCD34D', // copper-bright — warm pre-selection
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.4, 18, 3.0],
          'line-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            1,
            0,
          ],
        },
      })

      // Selected fill — visible body, not just outline.
      m.addLayer({
        id: 'parcels-selected-fill',
        type: 'fill',
        source: 'parcels',
        minzoom: 13,
        filter: ['==', ['get', 'OBJECTID'], NO_SELECTION],
        paint: {
          'fill-color': '#F59E0B', // copper
          'fill-opacity': 0.24,
        },
      })

      m.addLayer({
        id: 'parcels-selected',
        type: 'line',
        source: 'parcels',
        minzoom: 13,
        filter: ['==', ['get', 'OBJECTID'], NO_SELECTION],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#F59E0B', // copper — same as chrome wordmark
          'line-width': 3.5,
          'line-opacity': 1,
        },
      })

      // Corner nodes — the surveyor signal. Small navy-stroked, parchment-
      // filled circles at each polygon vertex of the selected parcel.
      // Source data is set on selectParcel and cleared on clearSelection.
      m.addSource('parcel-corners', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      m.addLayer({
        id: 'parcel-corners',
        type: 'circle',
        source: 'parcel-corners',
        minzoom: 13,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2.5, 18, 4.5],
          'circle-color': '#F8FAFC', // parchment fill
          'circle-stroke-color': '#334155', // navy outline
          'circle-stroke-width': 1.25,
        },
      })

      loadRef.current(m)
    })

    m.on('moveend', () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => loadRef.current(m), 250)
      // Sync map view -> URL so reload / share preserves position.
      const c = m.getCenter()
      const params = new URLSearchParams(window.location.search)
      const parcel = params.get('parcel')
      updateAddressBar({
        view: { lng: c.lng, lat: c.lat, zoom: m.getZoom() },
        parcelKey: parcel,
      })
    })

    m.on('click', 'parcels-fill', (e) => {
      const raw = e.features?.[0]
      if (!raw) return
      // MapLibre's MapGeoJSONFeature widens properties to a Record. We narrow
      // back to ParcelFeature using the schema we control via the ArcGIS
      // outFields list.
      const f = raw as unknown as ParcelFeature
      selectRef.current(f, m)
    })
    // Cursor hint + hover highlight via feature-state. Track the last hovered
    // feature id so we can clear its state when mousemove crosses to a new one.
    let hoveredId: number | string | null = null
    const clearHover = () => {
      if (hoveredId != null) {
        m.setFeatureState({ source: 'parcels', id: hoveredId }, { hover: false })
        hoveredId = null
      }
    }
    m.on('mouseenter', 'parcels-fill', () => (m.getCanvas().style.cursor = 'pointer'))
    m.on('mousemove', 'parcels-fill', (e) => {
      const f = e.features?.[0]
      if (!f || f.id == null) return
      if (hoveredId !== f.id) {
        clearHover()
        hoveredId = f.id
        m.setFeatureState({ source: 'parcels', id: hoveredId }, { hover: true })
      }
    })
    m.on('mouseleave', 'parcels-fill', () => {
      m.getCanvas().style.cursor = ''
      clearHover()
    })

    map.current = m
    // Expose for E2E tests only — see src/types/global.d.ts
    window.__map__ = m

    const ro = new ResizeObserver(() => m.resize())
    ro.observe(mapContainer.current)

    // Terra Draw lazily — once the map is loaded so its layers/sources exist.
    m.once('load', () => {
      const draw = createDraw(m, {
        onPolygonComplete: (ring) => {
          // ring is the polygon outer ring including the closing duplicate
          // vertex. Send to /api/parcels with polygon spatial filter.
          void (async () => {
            setLoading(true)
            try {
              const data = await queryParcelsInPolygon(ring, COUNTY_ALL)
              rawParcelsRef.current = data as GeoJSON.FeatureCollection
              const filtered = applyClientFilters(data as GeoJSON.FeatureCollection, filtersRef.current)
              setSearchResults(filtered.features as ParcelFeature[])
              const src = m.getSource('parcels') as maplibregl.GeoJSONSource | undefined
              src?.setData(filtered)
              setParcelCount(filtered.features.length)
            } catch (e) {
              console.error('[lasso] failed', e)
              setSearchResults([])
            } finally {
              setLoading(false)
              // Drop draw mode back to idle but keep the polygon visible until
              // the user clears the result panel.
              draw.setMode('static')
              setDrawModeState('idle')
            }
          })()
        },
        onLineComplete: (line) => {
          setRulerDistance(formatDistance(lineDistanceMeters(line)))
          draw.setMode('static')
          setDrawModeState('idle')
        },
      })
      draw.start()
      // Default to static so map clicks pass through to parcel selection.
      // The Lasso / Ruler buttons switch into polygon / linestring mode.
      draw.setMode('static')
      drawRef.current = draw
    })

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      ro.disconnect()
      drawRef.current?.stop()
      drawRef.current = null
      m.remove()
      map.current = null
      delete window.__map__
    }
  }, [])

  const loadParcelsForViewport = useCallback(async (m: maplibregl.Map) => {
    const src = m.getSource('parcels') as maplibregl.GeoJSONSource | undefined
    const zoom = m.getZoom()
    if (zoom < 13) {
      src?.setData({ type: 'FeatureCollection', features: [] })
      setParcelCount(0)
      return
    }
    const b = m.getBounds()
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()
    setLoading(true)
    try {
      const data = await queryParcelsByBbox(b.getWest(), b.getSouth(), b.getEast(), b.getNorth(), COUNTY_ALL, abortRef.current.signal)
      rawParcelsRef.current = data as GeoJSON.FeatureCollection
      const filtered = applyClientFilters(data as GeoJSON.FeatureCollection, filtersRef.current)
      src?.setData(filtered)
      setParcelCount(filtered.features.length)
    } catch (e) {
      if (!isAbortError(e)) {
        console.error('[parcels] viewport load failed', e)
        setParcelCount(0)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const selectParcel = useCallback(async (f: ParcelFeature, m: maplibregl.Map) => {
    setSelectedParcel(f)
    // Detail and search-results live in the same right-side slot. Picking a
    // parcel — from the map or from a result list — closes the list so the
    // detail panel can take over without overlap.
    setSearchResults(null)
    // The selected-state layers (parcels-selected outline + parcels-selected-fill
    // body) are added on map 'load'. If the user lands on a permalink and we
    // resolve it before load, guard the filter call.
    if (m.getLayer('parcels-selected')) {
      m.setFilter('parcels-selected', ['==', ['get', 'OBJECTID'], f.properties.OBJECTID])
    }
    if (m.getLayer('parcels-selected-fill')) {
      m.setFilter('parcels-selected-fill', ['==', ['get', 'OBJECTID'], f.properties.OBJECTID])
    }
    // Corner nodes — extract every polygon vertex (handles MultiPolygon)
    // and paint as Point features. The Survey Corner brand mark in miniature.
    const cornerSrc = m.getSource('parcel-corners') as maplibregl.GeoJSONSource | undefined
    if (cornerSrc) {
      const points: number[][] = []
      collectCoords(f.geometry.coordinates, points)
      cornerSrc.setData({
        type: 'FeatureCollection',
        features: points.map((p) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: p },
          properties: {},
        })),
      })
    }

    const gislink = f.properties.GISLINK
    // Sync selection to URL.
    const c = m.getCenter()
    updateAddressBar({
      view: { lng: c.lng, lat: c.lat, zoom: m.getZoom() },
      parcelKey: gislink ?? null,
    })

    // Recent-parcels memory. Persists in localStorage so the user can come
    // back tomorrow and find what they were looking at. When auth lands this
    // history migrates to D1 on first login (see src/lib/storage.ts).
    if (gislink) {
      pushRecent(gislink, {
        owner: f.properties.OWNER ?? null,
        address: f.properties.ADDRESS ?? null,
      })
    }

    if (!gislink) {
      setEnriched(null)
      return
    }
    setEnrichLoading(true)
    try {
      const data = await getPropertyData(gislink)
      setEnriched(data)
    } catch (e) {
      console.error('[property] enrichment failed', e)
      setEnriched(null)
    } finally {
      setEnrichLoading(false)
    }
  }, [])

  const flyToFeature = useCallback((f: ParcelFeature, m: maplibregl.Map) => {
    const b = featureBounds(f)
    if (b) m.fitBounds(b, { padding: 120, maxZoom: 17 })
  }, [])

  // Searching is independent of parcel-load loading. The 'Loading…' status
  // pill at the bottom of the screen tracks parcels-fetched. The inline
  // spinner inside the search bar tracks search requests specifically — they
  // can be in flight at the same time without one masking the other.
  const [searching, setSearching] = useState(false)

  const doSearch = useCallback(async (queryOverride?: string) => {
    const q = (queryOverride ?? searchQuery).trim()
    if (!q || !map.current) return
    setSearching(true)
    try {
      const data = await searchParcels(q, COUNTY_ALL)
      rawParcelsRef.current = data as GeoJSON.FeatureCollection
      const filtered = applyClientFilters(data as GeoJSON.FeatureCollection, filtersRef.current)
      const features = filtered.features as ParcelFeature[]
      setSearchResults(features)
      if (features.length > 0) {
        const src = map.current.getSource('parcels') as maplibregl.GeoJSONSource | undefined
        src?.setData(filtered)
        setParcelCount(features.length)
        const b = unionBounds(features)
        if (b) map.current.fitBounds(b, { padding: 80, maxZoom: 17 })
      }
    } catch (e) {
      console.error('[search] failed', e)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [searchQuery])

  const pickResult = useCallback(
    (f: ParcelFeature) => {
      if (!map.current) return
      selectParcel(f, map.current)
      flyToFeature(f, map.current)
      setSearchResults(null)
    },
    [selectParcel, flyToFeature],
  )

  const closeSearchResults = useCallback(() => setSearchResults(null), [])

  const clearSearch = useCallback(() => {
    setSearchQuery('')
    setSearchResults(null)
  }, [])

  const toggleContours = () => {
    const next = !contoursVisible
    setContoursVisible(next)
    map.current?.setLayoutProperty('contour-lines', 'visibility', next ? 'visible' : 'none')
  }

  const switchDrawMode = useCallback((next: DrawMode) => {
    if (!drawRef.current) return
    const target: DrawMode = drawMode === next ? 'idle' : next
    setDrawModeState(target)
    if (target === 'idle') setRulerDistance(null)
    setDrawMode(drawRef.current, target)
  }, [drawMode])

  const clearSelection = () => {
    setSelectedParcel(null)
    setEnriched(null)
    const m = map.current
    if (m?.getLayer('parcels-selected')) {
      m.setFilter('parcels-selected', ['==', ['get', 'OBJECTID'], NO_SELECTION])
    }
    if (m?.getLayer('parcels-selected-fill')) {
      m.setFilter('parcels-selected-fill', ['==', ['get', 'OBJECTID'], NO_SELECTION])
    }
    const cornerSrc = m?.getSource('parcel-corners') as maplibregl.GeoJSONSource | undefined
    cornerSrc?.setData({ type: 'FeatureCollection', features: [] })
    if (m) {
      const c = m.getCenter()
      updateAddressBar({
        view: { lng: c.lng, lat: c.lat, zoom: m.getZoom() },
        parcelKey: null,
      })
    }
  }

  const sharePermalink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 1800)
    } catch (e) {
      console.error('[share] clipboard write failed', e)
    }
  }, [])

  // Keep refs in sync with the latest callbacks/state so the map's persistent
  // event handlers always see the current values.
  useEffect(() => {
    loadRef.current = loadParcelsForViewport
    selectRef.current = selectParcel
  }, [loadParcelsForViewport, selectParcel])

  // Toggle basemap layer visibility when the user picks a new basemap.
  // Hybrid stacks imagery + reference labels; the others are single-layer.
  useEffect(() => {
    const m = map.current
    if (!m) return
    const apply = () => {
      const visible = new Set(BASEMAP_LAYERS[basemap])
      for (const id of ALL_BASEMAP_LAYER_IDS) {
        if (!m.getLayer(id)) continue
        m.setLayoutProperty(id, 'visibility', visible.has(id) ? 'visible' : 'none')
      }
    }
    if (m.isStyleLoaded()) apply()
    else m.once('load', apply)
  }, [basemap])

  // Global keyboard shortcut: '/' or Cmd-K / Ctrl-K focuses the search input.
  // Skipped when the user is already typing into another input/textarea so
  // we don't hijack form fields. Mirrors GitHub / Linear / Notion convention.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inField =
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      const isSlash = e.key === '/' && !inField
      const isCmdK = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)
      if (isSlash || isCmdK) {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Re-apply client-side filters when the user toggles them. Operates on the
  // last-loaded raw feature collection — instant, no API roundtrip.
  useEffect(() => {
    filtersRef.current = filters
    const m = map.current
    if (!m || !rawParcelsRef.current) return
    const filtered = applyClientFilters(rawParcelsRef.current, filters)
    const src = m.getSource('parcels') as maplibregl.GeoJSONSource | undefined
    src?.setData(filtered)
    setParcelCount(filtered.features.length)
  }, [filters])

  // Re-apply selected-state filters + corner nodes whenever selection or
  // layer-readiness changes. Without this, a permalink-loaded parcel may
  // not paint its selected state if the map's 'load' event fires after
  // selectParcel runs.
  useEffect(() => {
    const m = map.current
    if (!m) return
    const id = selectedParcel?.properties.OBJECTID ?? NO_SELECTION
    const apply = () => {
      if (m.getLayer('parcels-selected')) {
        m.setFilter('parcels-selected', ['==', ['get', 'OBJECTID'], id])
      }
      if (m.getLayer('parcels-selected-fill')) {
        m.setFilter('parcels-selected-fill', ['==', ['get', 'OBJECTID'], id])
      }
      const cornerSrc = m.getSource('parcel-corners') as maplibregl.GeoJSONSource | undefined
      if (cornerSrc) {
        if (selectedParcel) {
          const points: number[][] = []
          collectCoords(selectedParcel.geometry.coordinates, points)
          cornerSrc.setData({
            type: 'FeatureCollection',
            features: points.map((p) => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: p },
              properties: {},
            })),
          })
        } else {
          cornerSrc.setData({ type: 'FeatureCollection', features: [] })
        }
      }
    }
    if (m.isStyleLoaded() && m.getLayer('parcels-selected')) {
      apply()
    } else {
      m.once('load', apply)
    }
  }, [selectedParcel])

  // Resolve the initial ?parcel= URL param exactly once. Fly to it and select.
  useEffect(() => {
    const key = initialPermalink.current.parcelKey
    if (!key || !map.current) return
    let cancelled = false
    void (async () => {
      try {
        const f = await getParcelByKey(key)
        if (cancelled || !map.current) return
        // If the URL didn't include a view, frame the parcel we're loading.
        if (!initialPermalink.current.view) {
          flyToFeature(f, map.current)
        }
        selectParcel(f, map.current)
      } catch (e) {
        console.error('[permalink] parcel lookup failed', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [flyToFeature, selectParcel])

  return (
    <div
      className="relative h-full w-full"
      role="application"
      aria-label="Parcel map — pan and zoom to explore parcels"
    >
      <div
        ref={mapContainer}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      />

      {/* Top bar — row 1: logo + search + view controls (always visible).
          All tap targets are at least 40px tall (WCAG 2.5.5 AA / iOS HIG comfortable).
          pointer-events-none on the wrapper so map clicks pass through any
          empty space between the buttons; pointer-events-auto on each child. */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-2 pointer-events-none [&>*]:pointer-events-auto">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <div className="relative flex-1 min-w-0">
            <input
              ref={searchInputRef}
              // Use type=text not type=search to avoid the native browser X
              // overlapping our custom Clear button.
              type="text"
              aria-label="Search owner, address, or parcel ID"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => {
                // Defer so a click on a typeahead item lands before we hide it.
                setTimeout(() => setSearchFocused(false), 120)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setSearchFocused(false)
                  doSearch()
                }
                if (e.key === 'Escape') {
                  clearSearch()
                  searchInputRef.current?.blur()
                }
              }}
              placeholder='Owner, address, or parcel ID — try "Smith" or 090046M H 01300'
              // text-base (16px) on the input — anything smaller triggers
              // iOS Safari's auto-zoom-on-focus, which is awful on a map UI.
              className="w-full bg-surface/90 backdrop-blur border border-border-default text-white text-base sm:text-sm px-3 pr-10 h-10 rounded-lg placeholder:text-text-tertiary outline-none focus:border-brand"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Clear search"
                className="absolute right-1 top-1 inline-flex items-center justify-center w-8 h-8 rounded-md text-text-tertiary hover:text-white hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <SearchSuggestions
              visible={searchFocused && searchResults === null}
              query={searchQuery}
              onPick={(gislink, owner, address) => {
                setSearchFocused(false)
                // Use the most distinctive existing token for the search
                // request — owner is more likely to disambiguate than address.
                const q = owner || address || gislink
                setSearchQuery(q)
                doSearch(q)
              }}
            />
          </div>
          <Button
            size="default"
            onClick={() => doSearch()}
            aria-label="Search"
            className="h-10 w-10 px-0"
            disabled={searching}
          >
            {searching ? (
              <span
                aria-hidden="true"
                className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
              />
            ) : (
              <Search className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Recent parcels pill — bottom-left, above the MapLibre ScaleControl.
          Pre-auth come-back loop: localStorage holds the last 15 viewed
          parcels. Day 3 of polish-pass-1. */}
      <RecentParcelsPill
        onPick={async (gislink) => {
          if (!map.current) return
          try {
            const f = await getParcelByKey(gislink)
            if (!map.current) return
            flyToFeature(f, map.current)
            selectParcel(f, map.current)
          } catch (e) {
            console.error('[recents] parcel lookup failed', e)
          }
        }}
      />

      {/* Bottom action bar — the menu system. Universal across viewports.
          Native HTML semantics (<nav role="toolbar">), tap targets >= 48px,
          backdrop-blur frosted look (iOS / macOS / Material 3 convention),
          safe-area-inset-bottom respects iOS home indicator. */}
      <nav
        role="toolbar"
        aria-label="Map actions"
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none [&>*]:pointer-events-auto safe-bottom"
      >
        <div className="flex items-center gap-1 rounded-2xl bg-surface/90 backdrop-blur border border-border-default p-1 shadow-lg">
          <ActionBarButton
            label="Map layers"
            pressed={layersOpen || basemap !== 'satellite' || contoursVisible}
            onClick={() => {
              setLayersOpen((v) => !v)
              setToolsOpen(false)
            }}
            icon={<Layers className="w-5 h-5" />}
            text="Layers"
          />
          <ActionBarButton
            label="Drawing tools"
            pressed={toolsOpen}
            onClick={() => {
              setToolsOpen((v) => !v)
              setLayersOpen(false)
            }}
            icon={<Ruler className="w-5 h-5" />}
            text="Tools"
          />
          <ActionBarButton
            label={filtersActiveCount(filters) > 0 ? `Filter · ${filtersActiveCount(filters)}` : 'Filter'}
            pressed={filtersActiveCount(filters) > 0 || filterOpen}
            onClick={() => setFilterOpen(true)}
            icon={<Filter className="w-5 h-5" />}
            text={filtersActiveCount(filters) > 0 ? `Filter · ${filtersActiveCount(filters)}` : 'Filter'}
          />
          <ActionBarButton
            label="Locate me"
            onClick={() => geolocateRef.current?.trigger()}
            icon={<LocateFixed className="w-5 h-5" />}
            text="Locate"
          />
          <ActionBarButton
            label="Recenter to overview"
            onClick={() => map.current?.flyTo({ center: [-82.35, 36.35], zoom: 11, essential: true })}
            icon={<Crosshair className="w-5 h-5" />}
            text="Reset"
          />
        </div>
      </nav>

      {/* Layers popover — basemap chooser + overlay toggles. Appears above
          the bottom bar when Layers is pressed. */}
      {layersOpen && (
        <div
          role="menu"
          aria-label="Map layers"
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none [&>*]:pointer-events-auto"
        >
          <div className="rounded-2xl bg-surface/95 backdrop-blur border border-border-default shadow-xl overflow-hidden w-72">
            <div className="px-3 py-2 border-b border-border-subtle text-[10px] uppercase tracking-wider text-text-tertiary">
              Basemap
            </div>
            <div className="grid grid-cols-2 gap-1 p-2">
              {([
                { id: 'satellite', label: 'Satellite' },
                { id: 'streets', label: 'Streets' },
                { id: 'topo', label: 'Topographic' },
                { id: 'hybrid', label: 'Hybrid' },
              ] as const).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setBasemap(opt.id)}
                  aria-pressed={basemap === opt.id}
                  className={cn(
                    'h-10 rounded-lg text-xs font-medium transition-colors',
                    basemap === opt.id
                      ? 'bg-brand text-white'
                      : 'bg-white/5 text-text-primary hover:bg-white/10',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="px-3 py-2 border-t border-border-subtle text-[10px] uppercase tracking-wider text-text-tertiary">
              Overlays
            </div>
            <div className="p-2">
              <button
                type="button"
                role="switch"
                aria-checked={contoursVisible}
                onClick={toggleContours}
                className={cn(
                  'w-full flex items-center justify-between gap-3 px-3 h-10 rounded-lg text-left text-sm transition-colors',
                  contoursVisible ? 'bg-brand/20 text-white' : 'hover:bg-white/5 text-text-primary',
                )}
              >
                <span className="flex items-center gap-2">
                  <Mountain className="w-4 h-4" /> Contour lines
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-block w-9 h-5 rounded-full relative transition-colors',
                    contoursVisible ? 'bg-brand' : 'bg-white/15',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                      contoursVisible ? 'translate-x-4' : 'translate-x-0.5',
                    )}
                  />
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tools popover — appears above the bottom bar when Tools is pressed. */}
      {toolsOpen && (
        <div
          role="menu"
          aria-label="Drawing tools"
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none [&>*]:pointer-events-auto"
        >
          <div className="flex items-center gap-1 rounded-2xl bg-surface/95 backdrop-blur border border-border-default p-1 shadow-xl">
            <ActionBarButton
              label="Lasso parcels"
              pressed={drawMode === 'lasso'}
              onClick={() => {
                switchDrawMode('lasso')
                setToolsOpen(false)
              }}
              icon={<Lasso className="w-5 h-5" />}
              text="Lasso"
            />
            <ActionBarButton
              label="Measure distance"
              pressed={drawMode === 'ruler'}
              onClick={() => {
                switchDrawMode('ruler')
                setToolsOpen(false)
              }}
              icon={<Ruler className="w-5 h-5" />}
              text="Ruler"
            />
            {(drawMode !== 'idle' || rulerDistance) && (
              <ActionBarButton
                label="Cancel drawing"
                onClick={() => {
                  switchDrawMode('idle')
                  setToolsOpen(false)
                }}
                icon={<MousePointer2 className="w-5 h-5" />}
                text="Cancel"
              />
            )}
          </div>
        </div>
      )}

      {/* Filter sheet — bottom-sheet dialog driven by computed insights.
          Uses a native HTMLDialogElement for built-in modal behavior +
          Escape-to-close. Filters are AND'd; toggling them re-runs the
          last-loaded data through passesFilters() in-memory. */}
      <FilterSheet
        open={filterOpen}
        filters={filters}
        onChange={setFilters}
        onClose={() => setFilterOpen(false)}
      />

      {/* Ruler distance pill — shown above the bottom bar */}
      {rulerDistance && (
        <div
          role="status"
          aria-live="polite"
          className="absolute bottom-20 right-3 z-10 px-4 py-2 rounded-full bg-surface/95 border border-brand text-xs text-white"
        >
          Ruler: <span className="font-bold">{rulerDistance}</span>
        </div>
      )}

      {/* Search results panel. Lives on the RIGHT side at the same slot the
          property detail panel uses — they're mutually exclusive (selecting a
          parcel closes the list). On mobile it spans the full width minus the
          right gutter. */}
      {searchResults !== null && (
        <div className="absolute top-16 right-3 left-3 sm:left-auto sm:w-96 z-30 max-h-[70vh] flex flex-col">
          <Card className="flex flex-col overflow-hidden">
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0 gap-2">
              <CardTitle className="text-sm">
                {searchResults.length === 0
                  ? 'No matches'
                  : `${searchResults.length} ${searchResults.length === 1 ? 'match' : 'matches'}`}
              </CardTitle>
              <button
                onClick={closeSearchResults}
                aria-label="Close search results"
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-text-tertiary hover:text-white hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent className="p-0 overflow-y-auto">
              {searchResults.length === 0 && (
                <div className="px-4 py-6 text-xs text-text-tertiary">
                  Try a different name, street, or parcel ID.
                </div>
              )}
              {searchResults.length > 0 && (
                <ul className="divide-y divide-border-subtle">
                  {searchResults.slice(0, 200).map((f) => {
                    const addr = f.properties.ADDRESS || `${f.properties.ST_NUM ?? ''} ${f.properties.STREET ?? ''}`.trim()
                    const acres = f.properties.CALC_ACRE != null ? `${f.properties.CALC_ACRE.toFixed(2)} ac` : null
                    return (
                      <li key={f.properties.OBJECTID}>
                        <button
                          type="button"
                          onClick={() => pickResult(f)}
                          className="w-full text-left px-4 py-3 min-h-[64px] hover:bg-white/5 active:bg-white/10 focus:outline-none focus:bg-white/10 transition-colors"
                        >
                          <div className="text-sm text-text-primary font-medium truncate">
                            {f.properties.OWNER || 'Unknown owner'}
                          </div>
                          {addr && (
                            <div className="text-xs text-text-tertiary truncate mt-0.5">{addr}</div>
                          )}
                          <div className="text-[10px] uppercase tracking-wider text-brand/80 mt-1">
                            {f.properties.COUNTYNAME?.replace(' County', '') ?? '—'}
                            {acres ? ` · ${acres}` : ''}
                            {f.properties.GISLINK ? ` · ${f.properties.GISLINK}` : ''}
                          </div>
                        </button>
                      </li>
                    )
                  })}
                  {searchResults.length > 200 && (
                    <li className="px-4 py-3 text-[11px] text-text-tertiary">
                      Showing 200 of {searchResults.length} matches — refine your query to narrow.
                    </li>
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Single status pill — loading takes precedence over count to avoid
          one-frame overlap during the load -> loaded transition. */}
      {(loading || parcelCount > 0) && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            // Sits above the bottom action bar (which is at bottom-3 with h-14).
            'absolute bottom-24 left-1/2 -translate-x-1/2 z-10 px-4 py-1.5 rounded-full bg-surface/90 border border-border-default text-xs pointer-events-none',
            loading ? 'text-white' : 'text-text-tertiary',
          )}
        >
          {loading ? 'Loading…' : `${parcelCount} parcels visible`}
        </div>
      )}

      {/* Detail sidebar */}
      {selectedParcel && (
        <div className="absolute top-16 right-3 left-3 sm:left-auto z-20 sm:w-80 max-h-[calc(100%-6rem)] overflow-y-auto">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-1">
                <CardTitle className="text-sm">Property Details</CardTitle>
                <div className="flex items-center -mr-2 -mt-2">
                  <SaveButton gislink={selectedParcel.properties.GISLINK} />
                  <button
                    onClick={sharePermalink}
                    aria-label="Copy share link"
                    className="inline-flex items-center justify-center w-10 h-10 rounded-md text-text-tertiary hover:text-white hover:bg-white/10"
                    title={shareCopied ? 'Link copied' : 'Copy link to this parcel'}
                  >
                    {shareCopied ? <Check className="w-4 h-4 text-green-400" /> : <Share2 className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={clearSelection}
                    aria-label="Close property details"
                    className="inline-flex items-center justify-center w-10 h-10 rounded-md text-text-tertiary hover:text-white hover:bg-white/10"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <ParcelActions
                f={selectedParcel}
                onSearchOwner={(owner) => { setSearchQuery(owner); doSearch(owner) }}
              />
              <ParcelInsights f={selectedParcel} />

              {/* Hidden when empty — fields the county doesn't populate
                  (PROPTYPE, SALELABEL, ST_NUM/STREET) drop entirely instead
                  of decorating the panel with permanent dashes. */}
              <DetailField label="Parcel ID" value={selectedParcel.properties.GISLINK} mono />
              <DetailField label="Owner" value={[selectedParcel.properties.OWNER, selectedParcel.properties.OWNER2].filter(Boolean).join('\n')} />
              <DetailField label="Address" value={selectedParcel.properties.ADDRESS} />
              <DetailField label="County" value={selectedParcel.properties.COUNTYNAME} />
              <DetailField label="Acres" value={selectedParcel.properties.CALC_ACRE != null ? `${selectedParcel.properties.CALC_ACRE.toFixed(3)} ac` : null} mono />
              <DetailField label="Zoning" value={selectedParcel.properties.ZONING} mono />
              <DetailField label="Appraised Value" value={fmtMoney(selectedParcel.properties.APPRAISAL)} mono />
              <DetailField label="Last Sale Price" value={fmtMoney(selectedParcel.properties.PRICE)} mono />
              <DetailField label="Last Sale Date" value={fmtDate(selectedParcel.properties.SALEDATE)} mono />
              <DetailField label="Mailing Address" value={selectedParcel.properties.MAILADDR} />
              <DetailField label="Mail City/ST/ZIP" value={[selectedParcel.properties.MAILCITY, selectedParcel.properties.STATE].filter(Boolean).join(', ') + (selectedParcel.properties.ZIP ? ' ' + selectedParcel.properties.ZIP : '')} mono />

              {enrichLoading && (
                <div className="py-2 text-text-tertiary animate-pulse">Loading enriched data…</div>
              )}

              {enriched && (
                <>
                  {enriched.valuation && (
                    <div className="pt-2 border-t border-border-subtle">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-brand font-medium mb-1">
                        <TrendingUp className="w-3 h-3" /> Valuation (Supabase)
                      </div>
                      <DetailField label="Land Value" value={fmtMoney(enriched.valuation.land_value)} />
                      <DetailField label="Improvement Value" value={fmtMoney(enriched.valuation.improvement_value)} />
                      <DetailField label="Total Appraisal" value={fmtMoney(enriched.valuation.total_appraisal)} />
                      <DetailField label="Assessment" value={fmtMoney(enriched.valuation.assessment)} />
                    </div>
                  )}

                  {enriched.buildings.length > 0 && (
                    <div className="pt-2 border-t border-border-subtle">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-brand font-medium mb-1">
                        <Building2 className="w-3 h-3" /> Buildings ({enriched.buildings.length})
                      </div>
                      {enriched.buildings.map((b, i) => (
                        <div key={i} className="mb-2 pb-2 border-b border-text-tertiary/5 last:border-0">
                          <DetailField label={`Building ${b.building_number}`} value={`${b.sqft_living?.toLocaleString() || '?'} sqft | ${b.year_built || '?'} | ${b.stories || '?'} stories`} />
                          {b.quality && <DetailField label="Quality" value={b.quality} />}
                          {b.condition && <DetailField label="Condition" value={b.condition} />}
                          {b.exterior_wall && <DetailField label="Exterior" value={b.exterior_wall} />}
                          {b.heat_ac && <DetailField label="HVAC" value={b.heat_ac} />}
                          {b.foundation && <DetailField label="Foundation" value={b.foundation} />}
                        </div>
                      ))}
                    </div>
                  )}

                  {enriched.sales.length > 0 && (
                    <div className="pt-2 border-t border-border-subtle">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-brand font-medium mb-1">
                        <TrendingUp className="w-3 h-3" /> Sales History ({enriched.sales.length})
                      </div>
                      {enriched.sales.slice(0, 3).map((s, i) => (
                        <div key={i} className="mb-1.5">
                          <div className="text-text-primary">{fmtDate(s.sale_date)} — {fmtMoney(s.price)}</div>
                          <div className="text-text-tertiary text-[10px]">{s.instrument_type} | Book {s.deed_book} Page {s.deed_page} {s.qualification ? `| ${s.qualification}` : ''}</div>
                        </div>
                      ))}
                      {enriched.sales.length > 3 && (
                        <div className="text-text-tertiary text-[10px]">+{enriched.sales.length - 3} more sales</div>
                      )}
                    </div>
                  )}

                  {enriched.entities.length > 0 && (
                    <div className="pt-2 border-t border-border-subtle">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-brand font-medium mb-1">
                        <Users className="w-3 h-3" /> Linked Entities ({enriched.entities.length})
                      </div>
                      {enriched.entities.map((e, i) => (
                        <div key={i} className="mb-1">
                          <div className="text-text-primary">{e.name}</div>
                          <div className="text-text-tertiary text-[10px]">{e.entity_type} | {e.status || 'Unknown status'} {e.state ? `| ${e.state}` : ''}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

    </div>
  )
}

// FilterSheet — native HTMLDialogElement with bottom-sheet styling. Native
// modality gives us built-in focus trapping, Escape-to-close, and the
// inert-backdrop semantics for free.
function FilterSheet({
  open,
  filters,
  onChange,
  onClose,
}: {
  open: boolean
  filters: ParcelFilters
  onChange: (next: ParcelFilters) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const toggle = (key: keyof ParcelFilters) => () => {
    if (key === 'minAcres') return // handled separately
    onChange({ ...filters, [key]: !filters[key] })
  }

  const reset = () => onChange(emptyFilters)

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // light dismiss — click outside the sheet content closes
        if (e.target === ref.current) onClose()
      }}
      className="m-0 ml-auto mr-auto mb-0 sm:mb-auto sm:mt-auto p-0 bg-transparent backdrop:bg-black/50 backdrop:backdrop-blur-sm w-full sm:w-96 max-h-[85vh] rounded-t-2xl sm:rounded-2xl"
    >
      <div className="bg-surface/95 border border-border-default rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-white">Filter parcels</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="inline-flex items-center justify-center w-10 h-10 rounded-md text-text-tertiary hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 space-y-1">
          <FilterToggle label="Entity-owned (LLC, INC, TRUST, …)" hint="Detected from owner name" active={filters.entityOnly} onClick={toggle('entityOnly')} />
          <FilterToggle label="Out-of-state owner" hint="Mailing state ≠ TN" active={filters.outOfStateOnly} onClick={toggle('outOfStateOnly')} />
          <FilterToggle label="Absentee owner" hint="Parcel address ≠ owner mailing" active={filters.absenteeOnly} onClick={toggle('absenteeOnly')} />
          <FilterToggle label="Recent sale (≤ 5 years)" hint="From last sale date" active={filters.recentSaleOnly} onClick={toggle('recentSaleOnly')} />
          <FilterToggle label="Long-held (≥ 20 years)" hint="From last sale date" active={filters.longHeldOnly} onClick={toggle('longHeldOnly')} />

          <div className="pt-2">
            <label className="block text-[11px] uppercase tracking-wider text-text-tertiary font-medium mb-1.5">Minimum acres</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={0.25}
                value={filters.minAcres ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  onChange({ ...filters, minAcres: v === '' ? null : Number(v) })
                }}
                placeholder="any"
                // text-base (16px) prevents iOS auto-zoom on focus.
                className="flex-1 bg-white/5 border border-border-default text-white text-base sm:text-sm px-3 h-10 rounded-lg outline-none focus:border-brand"
              />
              <span className="text-xs text-text-tertiary">ac</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border-subtle bg-surface">
          <button
            type="button"
            onClick={reset}
            className="text-xs text-text-tertiary hover:text-white px-3 h-10 rounded-lg"
          >
            Reset all
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-white bg-brand hover:bg-brand/90 px-4 h-10 rounded-lg"
          >
            Done
          </button>
        </div>
      </div>
    </dialog>
  )
}

function FilterToggle({
  label,
  hint,
  active,
  onClick,
}: {
  label: string
  hint?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={active}
      className={cn(
        'w-full flex items-center justify-between gap-3 px-3 h-12 rounded-lg text-left transition-colors',
        active ? 'bg-brand/20' : 'hover:bg-white/5',
      )}
    >
      <div>
        <div className="text-sm text-text-primary">{label}</div>
        {hint && <div className="text-[10px] text-text-tertiary">{hint}</div>}
      </div>
      <span
        className={cn(
          'inline-flex items-center w-11 h-6 rounded-full border transition-colors shrink-0',
          active ? 'bg-brand border-brand' : 'bg-white/5 border-border-strong',
        )}
        aria-hidden
      >
        <span
          className={cn(
            'block w-5 h-5 rounded-full bg-white shadow transition-transform',
            active ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  )
}

// ParcelInsights renders the computed indicators (badges + math). Quick
// actions (Maps / Street View / More by owner / Copy address) live in the
// sibling ParcelActions row above. Every line here is gated on whether the
// underlying value computes — nothing shows when the data isn't there.
function ParcelInsights({ f }: { f: ParcelFeature }) {
  const p = f.properties
  const acres = p.CALC_ACRE
  const appraisal = p.APPRAISAL
  const price = p.PRICE
  const ppa = pricePerAcre(appraisal, acres)
  const yrs = yearsHeld(p.SALEDATE)
  const ht = holdingTier(yrs)
  const at = acreageTier(acres)
  const occ = occupancy(p)
  const oos = outOfState(p.STATE)
  const ent = entityKind(p.OWNER)
  const ratio = saleToAppraisalRatio(price, appraisal)

  const badges: Array<{ label: string; tone: 'amber' | 'blue' | 'rose' | 'gray' }> = []
  if (occ === 'absentee') badges.push({ label: 'Absentee', tone: 'amber' })
  if (occ === 'owner-occupied') badges.push({ label: 'Owner-occupied', tone: 'blue' })
  if (oos && p.STATE) badges.push({ label: `Out-of-state · ${p.STATE.toUpperCase()}`, tone: 'rose' })
  if (ent) badges.push({ label: `Entity · ${ent.toUpperCase()}`, tone: 'rose' })
  if (ht && yrs != null) badges.push({ label: `${formatYearsHeld(yrs)} held`, tone: ht === 'generational' || ht === 'long-held' ? 'gray' : 'blue' })
  if (at) badges.push({ label: acreageTierLabel(at), tone: 'gray' })

  const stats: Array<{ label: string; value: string }> = []
  if (ppa != null) stats.push({ label: '$/ac', value: formatPricePerAcre(ppa) ?? '' })
  if (ratio != null) stats.push({ label: 'Sold / appraised', value: formatRatioPercent(ratio) ?? '' })

  const hasAny = badges.length > 0 || stats.length > 0
  if (!hasAny) return null

  return (
    <div className="-mx-1 px-1 pb-2 space-y-2 border-b border-border-subtle">
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {badges.map((b, i) => (
            <span
              key={i}
              className={cn(
                'px-2 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wider',
                b.tone === 'amber' && 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
                b.tone === 'blue' && 'bg-sky-500/15 text-sky-300 border border-sky-500/30',
                b.tone === 'rose' && 'bg-rose-500/15 text-rose-300 border border-rose-500/30',
                b.tone === 'gray' && 'bg-white/5 text-text-tertiary border border-border-default',
              )}
            >
              {b.label}
            </span>
          ))}
        </div>
      )}

      {stats.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {stats.map((s, i) => (
            <div key={i}>
              <div className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">{s.label}</div>
              <div className="text-text-primary font-semibold">{s.value}</div>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}

// ParcelActions — quick-action chip row at the top of the property panel.
// Most-used actions surface here so the user doesn't have to scroll past the
// field list to find them: Maps, Street View, Copy address, More-by-owner.
function ParcelActions({
  f,
  onSearchOwner,
}: {
  f: ParcelFeature
  onSearchOwner: (owner: string) => void
}) {
  const p = f.properties
  const c = centroid(f.geometry)
  const ownerForSearch = ownerSearchTerm(p.OWNER)
  const [copiedAddr, setCopiedAddr] = useState(false)

  const copyAddress = useCallback(() => {
    const addr = [p.ADDRESS, p.MAILCITY, p.STATE, p.ZIP].filter(Boolean).join(', ')
    if (!addr || !navigator.clipboard) return
    navigator.clipboard.writeText(addr).then(
      () => {
        setCopiedAddr(true)
        setTimeout(() => setCopiedAddr(false), 1500)
      },
      // Permission denied / insecure context. Silent — the user will retry.
      () => {},
    )
  }, [p.ADDRESS, p.MAILCITY, p.STATE, p.ZIP])

  // Nothing to show? Don't render the row at all (better than an empty band).
  if (!c && !ownerForSearch && !p.ADDRESS) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {c && (
        <a
          href={googleMapsUrl(c[0], c[1])}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[11px] font-medium bg-white/5 text-text-primary border border-border-default hover:bg-white/10"
        >
          <MapIcon className="w-3.5 h-3.5" /> Maps
        </a>
      )}
      {c && (
        <a
          href={googleStreetViewUrl(c[0], c[1])}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[11px] font-medium bg-white/5 text-text-primary border border-border-default hover:bg-white/10"
        >
          <Eye className="w-3.5 h-3.5" /> Street View
        </a>
      )}
      {c && (
        <a
          href={appleMapsUrl(c[0], c[1], p.ADDRESS ?? undefined)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[11px] font-medium bg-white/5 text-text-primary border border-border-default hover:bg-white/10"
        >
          Apple
        </a>
      )}
      {p.ADDRESS && (
        <button
          type="button"
          onClick={copyAddress}
          aria-label={copiedAddr ? 'Address copied' : 'Copy address to clipboard'}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[11px] font-medium bg-white/5 text-text-primary border border-border-default hover:bg-white/10"
        >
          {copiedAddr ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copiedAddr ? 'Copied' : 'Copy address'}
        </button>
      )}
      {ownerForSearch && (
        <button
          type="button"
          onClick={() => onSearchOwner(ownerForSearch)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[11px] font-medium bg-brand/20 text-white border border-brand/40 hover:bg-brand/30"
        >
          <Users className="w-3.5 h-3.5" /> More by {ownerForSearch}
        </button>
      )}
    </div>
  )
}

// RecentParcelsPill — bottom-left pill that opens a list of the user's
// recently viewed parcels. Sourced from localStorage so it persists across
// reloads and tabs. Pre-auth stickiness; when auth lands, this graduates to
// a real "My Parcels" page using the same RecentParcel type from storage.ts.
function RecentParcelsPill({ onPick }: { onPick: (gislink: string) => void }) {
  const recents = useRecents()
  const [open, setOpen] = useState(false)

  // Close on outside click. The pill itself stops propagation so its own
  // clicks don't immediately re-close.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('[data-recents-pill]')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (recents.length === 0) return null

  return (
    <div
      data-recents-pill
      className="absolute top-14 left-3 z-20 pointer-events-none [&>*]:pointer-events-auto"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Recent parcels (${recents.length})`}
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11px] font-medium uppercase tracking-wider border transition-colors',
          open
            ? 'bg-brand text-white border-brand'
            : 'bg-surface/90 backdrop-blur text-text-primary border-border-default hover:bg-white/10',
        )}
      >
        <Clock className="w-3.5 h-3.5" />
        Recent · {recents.length}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Recent parcels"
          className="mt-2 w-72 max-h-[60vh] overflow-y-auto rounded-xl bg-surface/95 backdrop-blur border border-border-default shadow-xl brand-scroll"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
            <div className="text-[11px] uppercase tracking-wider text-text-tertiary">
              Recently viewed
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close recent list"
              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-text-tertiary hover:text-white hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <ul className="divide-y divide-border-subtle">
            {recents.map((r) => (
              <li key={r.gislink}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onPick(r.gislink)
                  }}
                  className="w-full text-left px-3 py-2 min-h-[48px] hover:bg-white/5 active:bg-white/10 focus:outline-none focus:bg-white/10 transition-colors"
                >
                  <div className="text-sm text-text-primary font-medium truncate">
                    {r.owner || r.address || r.gislink}
                  </div>
                  <div className="text-[11px] text-text-tertiary truncate mt-0.5">
                    {r.address ? `${r.address} · ` : ''}{r.gislink}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// SearchSuggestions — type-ahead dropdown sourced from the user's recently
// viewed parcels. Substring match on owner / address / gislink. Caps at 5.
// When `query` is empty and the input is focused, shows the most recent 5
// instead so the dropdown surfaces useful state on a fresh focus.
function SearchSuggestions({
  visible,
  query,
  onPick,
}: {
  visible: boolean
  query: string
  onPick: (gislink: string, owner: string, address: string) => void
}) {
  const recents = useRecents()
  if (!visible || recents.length === 0) return null
  const q = query.trim().toLowerCase()
  const matches: RecentParcel[] = q
    ? recents
        .filter((r) => {
          const hay = `${r.owner ?? ''} ${r.address ?? ''} ${r.gislink}`.toLowerCase()
          return hay.includes(q)
        })
        .slice(0, 5)
    : recents.slice(0, 5)
  if (matches.length === 0) return null

  return (
    <div
      role="listbox"
      aria-label="Recent parcels"
      className="absolute top-11 left-0 right-0 z-20 rounded-lg bg-surface/95 backdrop-blur border border-border-default shadow-xl overflow-hidden"
    >
      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-text-tertiary">
        {q ? 'Recent matches' : 'Recently viewed'}
      </div>
      <ul className="divide-y divide-border-subtle">
        {matches.map((r) => {
          const owner = r.owner ?? ''
          const addr = r.address ?? ''
          return (
            <li key={r.gislink}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                // onMouseDown so it fires before the input's blur handler hides us.
                onMouseDown={(e) => {
                  e.preventDefault()
                  onPick(r.gislink, owner, addr)
                }}
                className="w-full text-left px-3 py-2 min-h-[48px] hover:bg-white/5 active:bg-white/10 focus:outline-none focus:bg-white/10 transition-colors"
              >
                <div className="text-sm text-text-primary font-medium truncate">
                  {owner || addr || r.gislink}
                </div>
                {(addr || r.gislink) && (
                  <div className="text-[11px] text-text-tertiary truncate mt-0.5">
                    {addr ? `${addr} · ` : ''}{r.gislink}
                  </div>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// SaveButton — toggles a parcel's saved state in localStorage. Same UI/UX
// pre- and post-auth: when auth lands, the underlying storage layer swaps
// to D1 without any change here.
function SaveButton({ gislink }: { gislink: string | null | undefined }) {
  const saved = useIsSaved(gislink)
  if (!gislink) return null
  return (
    <button
      onClick={() => toggleSaved(gislink)}
      aria-label={saved ? 'Unsave parcel' : 'Save parcel'}
      aria-pressed={saved}
      title={saved ? 'Saved (click to unsave)' : 'Save this parcel'}
      className="inline-flex items-center justify-center w-10 h-10 rounded-md text-text-tertiary hover:text-white hover:bg-white/10"
    >
      <Star className={cn('w-4 h-4 transition-colors', saved ? 'fill-brand text-brand' : '')} />
    </button>
  )
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string
  value?: string | number | null
  /** Render value in tabular-mono (`.data-value`). Use for any numeric or
   *  parcel-ID-like field where vertical column alignment matters. */
  mono?: boolean
}) {
  // Don't render rows where the underlying field is empty. Showing rows of `—`
  // wastes vertical space and obscures the data that does matter.
  if (value == null || String(value).trim() === '' || String(value).trim() === ',') return null
  return (
    <div>
      <div className="data-label">{label}</div>
      <div className={mono ? 'data-value text-text-primary whitespace-pre-line' : 'text-text-primary whitespace-pre-line'}>
        {String(value)}
      </div>
    </div>
  )
}

// Bottom-bar button. 48x48 minimum tap target (Material 3 spec, also exceeds
// Apple HIG 44pt). Two-line layout (icon + text) so the function is legible
// at a glance without relying solely on icon recognition.
function ActionBarButton({
  label,
  pressed,
  onClick,
  icon,
  text,
}: {
  label: string
  pressed?: boolean
  onClick: () => void
  icon: React.ReactNode
  text: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed ?? false}
      title={label}
      className={cn(
        'flex flex-col items-center justify-center gap-0.5 min-w-[64px] h-14 px-3 rounded-xl text-[10px] font-medium uppercase tracking-wider transition-colors',
        pressed
          ? 'bg-brand text-white'
          : 'text-text-primary hover:bg-white/10 active:bg-white/15',
      )}
    >
      {icon}
      <span>{text}</span>
    </button>
  )
}

