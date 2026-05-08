import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import mlcontour from 'maplibre-contour'
import { queryParcelsByBbox, searchParcels, getPropertyData, getParcelByKey, queryParcelsInPolygon } from '@/lib/api'
import type { ParcelFeature } from '@/lib/arcgis'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Search, X, MapPinned, Crosshair, Building2, TrendingUp, Users, Share2, Check, Mountain, Lasso, Ruler, MousePointer2, LocateFixed } from 'lucide-react'
import { cn, fmtMoney, fmtDate } from '@/lib/utils'
import type { PropertyData } from '@/lib/supabase-queries'
import { parsePermalink, updateAddressBar, DEFAULT_MAP_VIEW } from '@/lib/permalink'
import { createDraw, setDrawMode, lineDistanceMeters, formatDistance, type DrawMode } from '@/lib/draw'
import type { TerraDraw } from 'terra-draw'

const NO_SELECTION: number = -1

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

const COUNTIES = ['ALL', 'Sullivan', 'Washington', 'Carter'] as const
type County = (typeof COUNTIES)[number]

export default function ParcelMap() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [activeCounty, setActiveCounty] = useState<County>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedParcel, setSelectedParcel] = useState<ParcelFeature | null>(null)
  const [enriched, setEnriched] = useState<PropertyData | null>(null)
  const [enrichLoading, setEnrichLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [parcelCount, setParcelCount] = useState(0)
  const [searchResults, setSearchResults] = useState<ParcelFeature[] | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [contoursVisible, setContoursVisible] = useState(false)
  const [drawMode, setDrawModeState] = useState<DrawMode>('idle')
  const [rulerDistance, setRulerDistance] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const drawRef = useRef<TerraDraw | null>(null)
  const geolocateRef = useRef<maplibregl.GeolocateControl | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialPermalink = useRef(parsePermalink(window.location.search))
  // Refs to the latest callbacks so the long-lived map event handlers
  // (registered once at init) always invoke the current closure. Without this,
  // the handlers would capture the first render's callbacks and miss state
  // updates (e.g. activeCounty changes).
  const loadRef = useRef<(m: maplibregl.Map) => void>(() => {})
  const selectRef = useRef<(f: ParcelFeature, m: maplibregl.Map) => void>(() => {})
  const countyRef = useRef<County>('ALL')

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
        name: 'TN Land Atlas',
        metadata: { 'tn-land-atlas:counties': ['Sullivan', 'Washington', 'Carter'] },
        sources: {
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
        },
        layers: [
          { id: 'esri-imagery', type: 'raster', source: 'esri-imagery', minzoom: 0, maxzoom: 22 },
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
    geolocateRef.current = geolocate

    m.on('load', () => {
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
          'line-color': 'rgba(255,200,120,0.55)',
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

      m.addLayer({
        id: 'parcels-fill',
        type: 'fill',
        source: 'parcels',
        // minzoom matches loadParcelsForViewport's zoom < 13 early-return.
        // No point in even attempting to paint at lower zooms.
        minzoom: 13,
        paint: {
          'fill-color': [
            'match', ['get', 'COUNTYNAME'],
            'Sullivan County', '#22c55e',
            'Washington County', '#0ea5e9',
            'Carter County', '#a855f7',
            '#94a3b8',
          ],
          'fill-opacity': 0.10,
        },
      })

      m.addLayer({
        id: 'parcels-line',
        type: 'line',
        source: 'parcels',
        minzoom: 13,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match', ['get', 'COUNTYNAME'],
            'Sullivan County', '#22c55e',
            'Washington County', '#0ea5e9',
            'Carter County', '#a855f7',
            '#94a3b8',
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 18, 2.2],
          'line-opacity': 0.9,
        },
      })

      m.addLayer({
        id: 'parcels-selected',
        type: 'line',
        source: 'parcels',
        minzoom: 13,
        filter: ['==', ['get', 'OBJECTID'], NO_SELECTION],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#fbbf24', 'line-width': 3.5, 'line-opacity': 1 },
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
    m.on('mouseenter', 'parcels-fill', () => (m.getCanvas().style.cursor = 'pointer'))
    m.on('mouseleave', 'parcels-fill', () => (m.getCanvas().style.cursor = ''))

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
              const data = await queryParcelsInPolygon(ring, countyRef.current)
              setSearchResults((data.features ?? []) as ParcelFeature[])
              const src = m.getSource('parcels') as maplibregl.GeoJSONSource | undefined
              src?.setData(data as GeoJSON.FeatureCollection)
              setParcelCount(data.features?.length ?? 0)
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
      const data = await queryParcelsByBbox(b.getWest(), b.getSouth(), b.getEast(), b.getNorth(), activeCounty, abortRef.current.signal)
      src?.setData(data as GeoJSON.FeatureCollection)
      setParcelCount(data.features?.length || 0)
    } catch (e) {
      if (!isAbortError(e)) {
        console.error('[parcels] viewport load failed', e)
        setParcelCount(0)
      }
    } finally {
      setLoading(false)
    }
  }, [activeCounty])

  const selectParcel = useCallback(async (f: ParcelFeature, m: maplibregl.Map) => {
    setSelectedParcel(f)
    // Detail and search-results live in the same right-side slot. Picking a
    // parcel — from the map or from a result list — closes the list so the
    // detail panel can take over without overlap.
    setSearchResults(null)
    m.setFilter('parcels-selected', ['==', ['get', 'OBJECTID'], f.properties.OBJECTID])

    const gislink = f.properties.GISLINK
    // Sync selection to URL.
    const c = m.getCenter()
    updateAddressBar({
      view: { lng: c.lng, lat: c.lat, zoom: m.getZoom() },
      parcelKey: gislink ?? null,
    })

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

  const doSearch = useCallback(async () => {
    const q = searchQuery.trim()
    if (!q || !map.current) return
    setLoading(true)
    try {
      const data = await searchParcels(q, activeCounty)
      const features = (data.features ?? []) as ParcelFeature[]
      setSearchResults(features)
      if (features.length > 0) {
        const src = map.current.getSource('parcels') as maplibregl.GeoJSONSource | undefined
        src?.setData(data as GeoJSON.FeatureCollection)
        setParcelCount(features.length)
        // Frame all matches so the user can see where they are.
        const b = unionBounds(features)
        if (b) map.current.fitBounds(b, { padding: 80, maxZoom: 17 })
      }
    } catch (e) {
      console.error('[search] failed', e)
      setSearchResults([])
    } finally {
      setLoading(false)
    }
  }, [searchQuery, activeCounty])

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
    map.current?.setFilter('parcels-selected', ['==', ['get', 'OBJECTID'], NO_SELECTION])
    if (map.current) {
      const c = map.current.getCenter()
      updateAddressBar({
        view: { lng: c.lng, lat: c.lat, zoom: map.current.getZoom() },
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

  useEffect(() => {
    countyRef.current = activeCounty
  }, [activeCounty])

  // Reload parcels when the active county filter changes.
  useEffect(() => {
    if (map.current) loadParcelsForViewport(map.current)
  }, [activeCounty, loadParcelsForViewport])

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
    <div className="relative h-full w-full">
      <div
        ref={mapContainer}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      />

      {/* Top bar — row 1: logo + search + view controls (always visible).
          All tap targets are at least 40px tall (WCAG 2.5.5 AA / iOS HIG comfortable).
          pointer-events-none on the wrapper so map clicks pass through any
          empty space between the buttons; pointer-events-auto on each child. */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-2 pointer-events-none [&>*]:pointer-events-auto safe-top">
        <div
          className="flex items-center gap-2 rounded-xl bg-brand-navy/90 backdrop-blur border border-brand-stone/15 px-3 h-10 shrink-0"
          aria-label="TN Land Atlas"
          title="TN Land Atlas"
        >
          <MapPinned className="w-4 h-4 text-brand-copper" />
          <span className="text-sm font-bold text-white whitespace-nowrap hidden sm:inline">TN Land Atlas</span>
        </div>

        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <div className="relative flex-1 min-w-0">
            <input
              type="search"
              aria-label="Search owner or address"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doSearch()
                if (e.key === 'Escape') clearSearch()
              }}
              placeholder="Search owner or address…"
              className="w-full bg-brand-navy/90 backdrop-blur border border-brand-stone/20 text-white text-sm px-3 pr-10 h-10 rounded-lg placeholder:text-brand-stone outline-none focus:border-brand-copper"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Clear search"
                className="absolute right-1 top-1 inline-flex items-center justify-center w-8 h-8 rounded-md text-brand-stone hover:text-white hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <Button size="default" onClick={doSearch} aria-label="Search" className="h-10 w-10 px-0">
            <Search className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Top bar — row 2: county filter pills (horizontally scrollable on mobile) */}
      <div
        role="group"
        aria-label="County filter"
        className="absolute top-[3.4rem] left-3 right-3 z-10 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide pointer-events-none [&>*]:pointer-events-auto"
      >
        {COUNTIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setActiveCounty(c)}
            aria-pressed={activeCounty === c}
            className={cn(
              // h-10 = 40px (WCAG 2.5.5 AA, comfortable on touch).
              'px-4 h-10 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0',
              activeCounty === c
                ? 'bg-brand-copper border-brand-copper text-white'
                : 'bg-brand-navy/90 backdrop-blur border-brand-stone/20 text-brand-parchment hover:bg-white/10'
            )}
          >
            {c === 'ALL' ? 'All' : c}
          </button>
        ))}
      </div>

      {/* Bottom action bar — the menu system. Universal across viewports.
          Native HTML semantics (<nav role="toolbar">), tap targets >= 48px,
          backdrop-blur frosted look (iOS / macOS / Material 3 convention),
          safe-area-inset-bottom respects iOS home indicator. */}
      <nav
        role="toolbar"
        aria-label="Map actions"
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none [&>*]:pointer-events-auto safe-bottom"
      >
        <div className="flex items-center gap-1 rounded-2xl bg-brand-navy/90 backdrop-blur border border-brand-stone/20 p-1 shadow-lg">
          <ActionBarButton
            label={contoursVisible ? 'Hide contour lines' : 'Show contour lines'}
            pressed={contoursVisible}
            onClick={toggleContours}
            icon={<Mountain className="w-5 h-5" />}
            text="Topo"
          />
          <ActionBarButton
            label="Drawing tools"
            pressed={toolsOpen}
            onClick={() => setToolsOpen((v) => !v)}
            icon={<Ruler className="w-5 h-5" />}
            text="Tools"
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

      {/* Tools popover — appears above the bottom bar when Tools is pressed. */}
      {toolsOpen && (
        <div
          role="menu"
          aria-label="Drawing tools"
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none [&>*]:pointer-events-auto"
        >
          <div className="flex items-center gap-1 rounded-2xl bg-brand-navy/95 backdrop-blur border border-brand-stone/20 p-1 shadow-xl">
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

      {/* Ruler distance pill — shown above the bottom bar */}
      {rulerDistance && (
        <div
          role="status"
          aria-live="polite"
          className="absolute bottom-20 right-3 z-10 px-4 py-2 rounded-full bg-brand-navy/95 border border-brand-copper text-xs text-white"
        >
          Ruler: <span className="font-bold">{rulerDistance}</span>
        </div>
      )}

      {/* Search results panel. Lives on the RIGHT side at the same slot the
          property detail panel uses — they're mutually exclusive (selecting a
          parcel closes the list). On mobile it spans the full width minus the
          right gutter. */}
      {searchResults !== null && (
        <div className="absolute top-28 right-3 left-3 sm:left-auto sm:w-96 z-30 max-h-[65vh] flex flex-col">
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
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-brand-stone hover:text-white hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent className="p-0 overflow-y-auto">
              {searchResults.length === 0 && (
                <div className="px-4 py-6 text-xs text-brand-stone">
                  Try a different name, street, or parcel ID. Filter is set to{' '}
                  <span className="text-brand-parchment">{activeCounty === 'ALL' ? 'all counties' : `${activeCounty} County`}</span>.
                </div>
              )}
              {searchResults.length > 0 && (
                <ul className="divide-y divide-brand-stone/10">
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
                          <div className="text-sm text-brand-parchment font-medium truncate">
                            {f.properties.OWNER || 'Unknown owner'}
                          </div>
                          {addr && (
                            <div className="text-xs text-brand-stone truncate mt-0.5">{addr}</div>
                          )}
                          <div className="text-[10px] uppercase tracking-wider text-brand-copper/80 mt-1">
                            {f.properties.COUNTYNAME?.replace(' County', '') ?? '—'}
                            {acres ? ` · ${acres}` : ''}
                            {f.properties.GISLINK ? ` · ${f.properties.GISLINK}` : ''}
                          </div>
                        </button>
                      </li>
                    )
                  })}
                  {searchResults.length > 200 && (
                    <li className="px-4 py-3 text-[11px] text-brand-stone">
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
            'absolute bottom-24 left-1/2 -translate-x-1/2 z-10 px-4 py-1.5 rounded-full bg-brand-navy/90 border border-brand-stone/20 text-xs pointer-events-none',
            loading ? 'text-white' : 'text-brand-stone',
          )}
        >
          {loading ? 'Loading…' : `${parcelCount} parcels visible`}
        </div>
      )}

      {/* Detail sidebar */}
      {selectedParcel && (
        <div className="absolute top-28 right-3 left-3 sm:left-auto z-20 sm:w-80 max-h-[calc(100%-9rem)] overflow-y-auto">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-1">
                <CardTitle className="text-sm">Property Details</CardTitle>
                <div className="flex items-center -mr-2 -mt-2">
                  <button
                    onClick={sharePermalink}
                    aria-label="Copy share link"
                    className="inline-flex items-center justify-center w-10 h-10 rounded-md text-brand-stone hover:text-white hover:bg-white/10"
                    title={shareCopied ? 'Link copied' : 'Copy link to this parcel'}
                  >
                    {shareCopied ? <Check className="w-4 h-4 text-green-400" /> : <Share2 className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={clearSelection}
                    aria-label="Close property details"
                    className="inline-flex items-center justify-center w-10 h-10 rounded-md text-brand-stone hover:text-white hover:bg-white/10"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              {/* Hidden when empty — fields the county doesn't populate
                  (PROPTYPE, SALELABEL, ST_NUM/STREET) drop entirely instead
                  of decorating the panel with permanent dashes. */}
              <DetailField label="Parcel ID" value={selectedParcel.properties.GISLINK} />
              <DetailField label="Owner" value={[selectedParcel.properties.OWNER, selectedParcel.properties.OWNER2].filter(Boolean).join('\n')} />
              <DetailField label="Address" value={selectedParcel.properties.ADDRESS} />
              <DetailField label="County" value={selectedParcel.properties.COUNTYNAME} />
              <DetailField label="Acres" value={selectedParcel.properties.CALC_ACRE != null ? `${selectedParcel.properties.CALC_ACRE.toFixed(3)} ac` : null} />
              <DetailField label="Zoning" value={selectedParcel.properties.ZONING} />
              <DetailField label="Appraised Value" value={fmtMoney(selectedParcel.properties.APPRAISAL)} />
              <DetailField label="Last Sale Price" value={fmtMoney(selectedParcel.properties.PRICE)} />
              <DetailField label="Last Sale Date" value={fmtDate(selectedParcel.properties.SALEDATE)} />
              <DetailField label="Mailing Address" value={selectedParcel.properties.MAILADDR} />
              <DetailField label="Mail City/ST/ZIP" value={[selectedParcel.properties.MAILCITY, selectedParcel.properties.STATE].filter(Boolean).join(', ') + (selectedParcel.properties.ZIP ? ' ' + selectedParcel.properties.ZIP : '')} />

              {enrichLoading && (
                <div className="py-2 text-brand-stone animate-pulse">Loading enriched data…</div>
              )}

              {enriched && (
                <>
                  {enriched.valuation && (
                    <div className="pt-2 border-t border-brand-stone/10">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-brand-copper font-medium mb-1">
                        <TrendingUp className="w-3 h-3" /> Valuation (Supabase)
                      </div>
                      <DetailField label="Land Value" value={fmtMoney(enriched.valuation.land_value)} />
                      <DetailField label="Improvement Value" value={fmtMoney(enriched.valuation.improvement_value)} />
                      <DetailField label="Total Appraisal" value={fmtMoney(enriched.valuation.total_appraisal)} />
                      <DetailField label="Assessment" value={fmtMoney(enriched.valuation.assessment)} />
                    </div>
                  )}

                  {enriched.buildings.length > 0 && (
                    <div className="pt-2 border-t border-brand-stone/10">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-brand-copper font-medium mb-1">
                        <Building2 className="w-3 h-3" /> Buildings ({enriched.buildings.length})
                      </div>
                      {enriched.buildings.map((b, i) => (
                        <div key={i} className="mb-2 pb-2 border-b border-brand-stone/5 last:border-0">
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
                    <div className="pt-2 border-t border-brand-stone/10">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-brand-copper font-medium mb-1">
                        <TrendingUp className="w-3 h-3" /> Sales History ({enriched.sales.length})
                      </div>
                      {enriched.sales.slice(0, 3).map((s, i) => (
                        <div key={i} className="mb-1.5">
                          <div className="text-brand-parchment">{fmtDate(s.sale_date)} — {fmtMoney(s.price)}</div>
                          <div className="text-brand-stone text-[10px]">{s.instrument_type} | Book {s.deed_book} Page {s.deed_page} {s.qualification ? `| ${s.qualification}` : ''}</div>
                        </div>
                      ))}
                      {enriched.sales.length > 3 && (
                        <div className="text-brand-stone text-[10px]">+{enriched.sales.length - 3} more sales</div>
                      )}
                    </div>
                  )}

                  {enriched.entities.length > 0 && (
                    <div className="pt-2 border-t border-brand-stone/10">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-brand-copper font-medium mb-1">
                        <Users className="w-3 h-3" /> Linked Entities ({enriched.entities.length})
                      </div>
                      {enriched.entities.map((e, i) => (
                        <div key={i} className="mb-1">
                          <div className="text-brand-parchment">{e.name}</div>
                          <div className="text-brand-stone text-[10px]">{e.entity_type} | {e.status || 'Unknown status'} {e.state ? `| ${e.state}` : ''}</div>
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

      {/* County color legend — top-left, below the pills, only on tablet+
          (mobile is too tight). The colors echo the parcel-line/-fill colors
          so users can read which county each polygon belongs to without
          tapping. */}
      <div className="absolute top-28 left-3 z-10 hidden sm:block pointer-events-none">
        <Card className="p-2.5 space-y-1 pointer-events-auto">
          <div className="text-[10px] uppercase tracking-wider text-brand-stone font-medium">Counties</div>
          <LegendItem color="#22c55e" label="Sullivan" />
          <LegendItem color="#0ea5e9" label="Washington" />
          <LegendItem color="#a855f7" label="Carter" />
        </Card>
      </div>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value?: string | number | null }) {
  // Don't render rows where the underlying field is empty. Showing rows of `—`
  // wastes vertical space and obscures the data that does matter.
  if (value == null || String(value).trim() === '' || String(value).trim() === ',') return null
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-brand-stone font-medium">{label}</div>
      <div className="text-brand-parchment whitespace-pre-line">{String(value)}</div>
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
          ? 'bg-brand-copper text-white'
          : 'text-brand-parchment hover:bg-white/10 active:bg-white/15',
      )}
    >
      {icon}
      <span>{text}</span>
    </button>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
      <span className="text-[11px] text-brand-parchment">{label}</span>
    </div>
  )
}
