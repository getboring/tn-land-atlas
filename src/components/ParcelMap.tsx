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
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

      loadParcelsForViewport(m)
    })

    m.on('moveend', () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => loadParcelsForViewport(m), 250)
    })

    m.on('click', 'parcels-fill', (e) => {
      const raw = e.features?.[0]
      if (!raw) return
      // MapLibre's MapGeoJSONFeature widens properties to a Record. We narrow
      // back to ParcelFeature using the schema we control via the ArcGIS
      // outFields list.
      const f = raw as unknown as ParcelFeature
      selectParcel(f, m)
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

  const doSearch = useCallback(async () => {
    if (!searchQuery.trim() || !map.current) return
    setLoading(true)
    try {
      const data = await searchParcels(searchQuery, activeCounty)
      if (data.features?.length) {
        const src = map.current.getSource('parcels') as maplibregl.GeoJSONSource | undefined
        src?.setData(data as GeoJSON.FeatureCollection)
        setParcelCount(data.features.length)
        const f = data.features[0]
        selectParcel(f, map.current)
        const coords = f.geometry.coordinates[0]
        const lons = coords.map((c) => c[0])
        const lats = coords.map((c) => c[1])
        map.current.fitBounds(
          [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
          { padding: 120, maxZoom: 17 }
        )
      }
    } catch (e) {
      console.error('[search] failed', e)
    } finally {
      setLoading(false)
    }
  }, [searchQuery, activeCounty, selectParcel])

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

  useEffect(() => {
    if (map.current) {
      loadParcelsForViewport(map.current)
    }
  }, [activeCounty, loadParcelsForViewport])

  return (
    <div className="relative h-full w-full">
      <div
        ref={mapContainer}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      />

      {/* Top bar — row 1: logo + search + view controls (always visible) */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl bg-brand-navy/90 backdrop-blur border border-brand-stone/15 px-3 py-2 shrink-0">
          <Layers className="w-4 h-4 text-brand-copper" />
          <span className="text-sm font-bold text-white whitespace-nowrap">TN Land Atlas</span>
        </div>

        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <input
            type="search"
            aria-label="Search owner or address"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="Search owner or address…"
            className="flex-1 min-w-0 bg-brand-navy/90 backdrop-blur border border-brand-stone/20 text-white text-sm px-3 py-1.5 rounded-lg placeholder:text-brand-stone outline-none focus:border-brand-copper"
          />
          <Button size="icon" onClick={doSearch} aria-label="Search">
            <Search className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" size="sm" onClick={toggleParcels}>
            {parcelsVisible ? 'Hide' : 'Show'}
          </Button>
          <Button variant="outline" size="sm" onClick={toggleBase}>
            {baseLayer === 'esri' ? 'NAIP' : 'Esri'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => map.current?.flyTo({ center: [-82.35, 36.35], zoom: 11 })} aria-label="Recenter">
            <Crosshair className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Top bar — row 2: county filter pills (horizontally scrollable on mobile) */}
      <div
        role="group"
        aria-label="County filter"
        className="absolute top-16 left-3 right-3 z-10 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide"
      >
        {COUNTIES.map((c) => (
          <button
            key={c}
            onClick={() => setActiveCounty(c)}
            aria-pressed={activeCounty === c}
            className={cn(
              'px-3 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0',
              activeCounty === c
                ? 'bg-brand-copper border-brand-copper text-white'
                : 'bg-brand-navy/90 backdrop-blur border-brand-stone/20 text-brand-parchment hover:bg-white/10'
            )}
          >
            {c === 'ALL' ? 'All' : c}
          </button>
        ))}
      </div>

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
                <button onClick={clearSelection} aria-label="Close property details" className="text-brand-stone hover:text-white"><X className="w-4 h-4" /></button>
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
