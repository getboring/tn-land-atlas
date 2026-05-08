import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { queryParcelsByBbox, searchParcels, getPropertyData } from '@/lib/api'
import type { ParcelFeature } from '@/lib/arcgis'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Search, X, Layers, Crosshair, Building2, TrendingUp, Users } from 'lucide-react'
import { cn, fmtMoney, fmtDate } from '@/lib/utils'
import type { PropertyData } from '@/lib/supabase-queries'

const NO_SELECTION: number = -1

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
  const [parcelsVisible, setParcelsVisible] = useState(true)
  const [baseLayer, setBaseLayer] = useState<'esri' | 'naip'>('esri')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedParcel, setSelectedParcel] = useState<ParcelFeature | null>(null)
  const [enriched, setEnriched] = useState<PropertyData | null>(null)
  const [enrichLoading, setEnrichLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [parcelCount, setParcelCount] = useState(0)
  const [searchResults, setSearchResults] = useState<ParcelFeature[] | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Refs to the latest callbacks so the long-lived map event handlers
  // (registered once at init) always invoke the current closure. Without this,
  // the handlers would capture the first render's callbacks and miss state
  // updates (e.g. activeCounty changes).
  const loadRef = useRef<(m: maplibregl.Map) => void>(() => {})
  const selectRef = useRef<(f: ParcelFeature, m: maplibregl.Map) => void>(() => {})

  useEffect(() => {
    if (!mapContainer.current || map.current) return

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'esri-imagery': {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            attribution: 'Esri',
          },
          'usgs-naip': {
            type: 'raster',
            tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 16,
            attribution: 'USGS NAIP',
          },
        },
        layers: [
          { id: 'esri-imagery', type: 'raster', source: 'esri-imagery', minzoom: 0, maxzoom: 22 },
          { id: 'usgs-naip', type: 'raster', source: 'usgs-naip', minzoom: 0, maxzoom: 22, layout: { visibility: 'none' } },
        ],
      },
      center: [-82.35, 36.35],
      zoom: 11,
      maxZoom: 19,
    })

    m.addControl(new maplibregl.NavigationControl(), 'top-right')
    m.addControl(new maplibregl.FullscreenControl(), 'top-right')
    m.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right')

    m.on('load', () => {
      m.addSource('parcels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

      m.addLayer({
        id: 'parcels-fill',
        type: 'fill',
        source: 'parcels',
        paint: {
          'fill-color': [
            'match', ['get', 'COUNTYNAME'],
            'Sullivan County', 'rgba(34,197,94,0.10)',
            'Washington County', 'rgba(14,165,233,0.10)',
            'Carter County', 'rgba(168,85,247,0.10)',
            'rgba(148,163,184,0.06)',
          ],
          'fill-outline-color': 'rgba(255,255,255,0.08)',
        },
      })

      m.addLayer({
        id: 'parcels-line',
        type: 'line',
        source: 'parcels',
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
        filter: ['==', ['get', 'OBJECTID'], NO_SELECTION],
        paint: { 'line-color': '#fbbf24', 'line-width': 3.5, 'line-opacity': 1 },
      })

      loadRef.current(m)
    })

    m.on('moveend', () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => loadRef.current(m), 250)
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

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      ro.disconnect()
      m.remove()
      map.current = null
      delete window.__map__
    }
  }, [])

  const loadParcelsForViewport = useCallback(async (m: maplibregl.Map) => {
    if (!parcelsVisible) return
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
  }, [activeCounty, parcelsVisible])

  const selectParcel = useCallback(async (f: ParcelFeature, m: maplibregl.Map) => {
    setSelectedParcel(f)
    m.setFilter('parcels-selected', ['==', ['get', 'OBJECTID'], f.properties.OBJECTID])

    const gislink = f.properties.GISLINK
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

  const toggleBase = () => {
    const next = baseLayer === 'esri' ? 'naip' : 'esri'
    setBaseLayer(next)
    map.current?.setLayoutProperty('esri-imagery', 'visibility', next === 'esri' ? 'visible' : 'none')
    map.current?.setLayoutProperty('usgs-naip', 'visibility', next === 'naip' ? 'visible' : 'none')
  }

  const toggleParcels = () => {
    const next = !parcelsVisible
    setParcelsVisible(next)
    const vis = next ? 'visible' : 'none'
    map.current?.setLayoutProperty('parcels-fill', 'visibility', vis)
    map.current?.setLayoutProperty('parcels-line', 'visibility', vis)
    map.current?.setLayoutProperty('parcels-selected', 'visibility', vis)
    if (next && map.current) loadParcelsForViewport(map.current)
    else {
      const src = map.current?.getSource('parcels') as maplibregl.GeoJSONSource | undefined
      src?.setData({ type: 'FeatureCollection', features: [] })
    }
  }

  const clearSelection = () => {
    setSelectedParcel(null)
    setEnriched(null)
    map.current?.setFilter('parcels-selected', ['==', ['get', 'OBJECTID'], NO_SELECTION])
  }

  // Keep refs in sync with the latest callbacks so the map's persistent
  // event handlers always see the current state.
  useEffect(() => {
    loadRef.current = loadParcelsForViewport
    selectRef.current = selectParcel
  }, [loadParcelsForViewport, selectParcel])

  // Reload parcels when the active county filter changes.
  useEffect(() => {
    if (map.current) loadParcelsForViewport(map.current)
  }, [activeCounty, loadParcelsForViewport])

  return (
    <div className="relative h-full w-full">
      <div
        ref={mapContainer}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      />

      {/* Top bar — row 1: logo + search + view controls (always visible).
          All tap targets are at least 40px tall (WCAG 2.5.5 AA / iOS HIG comfortable). */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl bg-brand-navy/90 backdrop-blur border border-brand-stone/15 px-3 h-10 shrink-0">
          <Layers className="w-4 h-4 text-brand-copper" />
          <span className="text-sm font-bold text-white whitespace-nowrap">TN Land Atlas</span>
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

        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" onClick={toggleParcels} className="h-10 px-3 text-xs">
            {parcelsVisible ? 'Hide' : 'Show'}
          </Button>
          <Button variant="outline" onClick={toggleBase} className="h-10 px-3 text-xs">
            {baseLayer === 'esri' ? 'NAIP' : 'Esri'}
          </Button>
          <Button variant="outline" onClick={() => map.current?.flyTo({ center: [-82.35, 36.35], zoom: 11 })} aria-label="Recenter" className="h-10 w-10 px-0">
            <Crosshair className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Top bar — row 2: county filter pills (horizontally scrollable on mobile) */}
      <div
        role="group"
        aria-label="County filter"
        className="absolute top-[3.4rem] left-3 right-3 z-10 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide"
      >
        {COUNTIES.map((c) => (
          <button
            key={c}
            onClick={() => setActiveCounty(c)}
            aria-pressed={activeCounty === c}
            className={cn(
              'px-4 h-9 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0',
              activeCounty === c
                ? 'bg-brand-copper border-brand-copper text-white'
                : 'bg-brand-navy/90 backdrop-blur border-brand-stone/20 text-brand-parchment hover:bg-white/10'
            )}
          >
            {c === 'ALL' ? 'All' : c}
          </button>
        ))}
      </div>

      {/* Search results panel. Appears under the top bar on the LEFT so it
          doesn't collide with the property detail panel on the right. On
          mobile it spans the full width. Picking a result closes the list. */}
      {searchResults !== null && (
        <div className="absolute top-28 left-3 right-3 sm:right-auto sm:w-96 z-30 max-h-[65vh] flex flex-col">
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
            'absolute bottom-6 left-1/2 -translate-x-1/2 z-10 px-4 py-1.5 rounded-full bg-brand-navy/90 border border-brand-stone/20 text-xs',
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
              <div className="flex items-start justify-between">
                <CardTitle className="text-sm">Property Details</CardTitle>
                <button
                  onClick={clearSelection}
                  aria-label="Close property details"
                  className="inline-flex items-center justify-center w-10 h-10 -mr-2 -mt-2 rounded-md text-brand-stone hover:text-white hover:bg-white/10"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <DetailField label="Parcel ID" value={selectedParcel.properties.GISLINK} />
              <DetailField label="Owner" value={[selectedParcel.properties.OWNER, selectedParcel.properties.OWNER2].filter(Boolean).join('\n')} />
              <DetailField label="Address" value={selectedParcel.properties.ADDRESS || `${selectedParcel.properties.ST_NUM ?? ''} ${selectedParcel.properties.STREET ?? ''}`.trim()} />
              <DetailField label="County" value={selectedParcel.properties.COUNTYNAME} />
              <DetailField label="Acres" value={selectedParcel.properties.CALC_ACRE != null ? `${selectedParcel.properties.CALC_ACRE.toFixed(3)} ac` : '—'} />
              <DetailField label="Property Type" value={selectedParcel.properties.PROPTYPE} />
              <DetailField label="Zoning" value={selectedParcel.properties.ZONING} />
              <DetailField label="Appraised Value" value={fmtMoney(selectedParcel.properties.APPRAISAL)} />
              <DetailField label="Last Sale Price" value={fmtMoney(selectedParcel.properties.PRICE)} />
              <DetailField label="Last Sale Date" value={fmtDate(selectedParcel.properties.SALEDATE)} />
              <DetailField label="Sale Label" value={selectedParcel.properties.SALELABEL} />
              <DetailField label="Mailing Address" value={selectedParcel.properties.MAILADDR} />
              <DetailField label="Mail City/ST/ZIP" value={`${selectedParcel.properties.MAILCITY || ''}, ${selectedParcel.properties.STATE || ''} ${selectedParcel.properties.ZIP || ''}`} />
              <DetailField label="Lat/Lng" value={selectedParcel.properties.LATITUDE != null && selectedParcel.properties.LONGITUDE != null ? `${selectedParcel.properties.LATITUDE.toFixed(6)}, ${selectedParcel.properties.LONGITUDE.toFixed(6)}` : '—'} />

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

      {/* Legend — hidden on mobile to preserve map space */}
      <div className="absolute bottom-6 left-3 z-10 hidden sm:block">
        <Card className="p-3 space-y-1.5">
          <div className="text-[11px] font-semibold text-white">Counties</div>
          <LegendItem color="#22c55e" label="Sullivan" />
          <LegendItem color="#0ea5e9" label="Washington" />
          <LegendItem color="#a855f7" label="Carter" />
        </Card>
      </div>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value?: string | number | null }) {
  const display = value && String(value).trim() ? String(value) : '—'
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-brand-stone font-medium">{label}</div>
      <div className="text-brand-parchment whitespace-pre-line">{display}</div>
    </div>
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
