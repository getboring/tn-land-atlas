// POST /api/roads: OSM Overpass road centerlines near a bbox.
//
// The user's parcel is small (typically <0.1 km²). We expand the bbox by
// a fixed margin so we always capture the nearest road even if it lies
// just outside the parcel envelope. The Overpass query returns way
// centerlines tagged `highway`; that's everything from motorways to
// driveways. For Phase 6d we only need centerline geometry — we'll do
// the geometric "which edge is nearest" math client-side.
//
// Caching: 1 hour at the edge. Overpass has rate limits (the public
// endpoints throttle around 10000 requests/day per IP) so the CF cache
// also protects the upstream from us as we develop. Production should
// switch to a paid Overpass tier or pre-baked TIGER tiles if traffic
// outgrows free rate limits.
//
// The Overpass endpoint sometimes returns 504 or 429 under load. The
// route surfaces those as 502 with a structured error; the client
// falls back to manual labeling silently.

import { validateBbox } from './_validate'

// Mirror of OSM's public Overpass API; both endpoints are fine. We prefer
// the German mirror because it tends to be more consistent during
// load spikes. Falling back to the main endpoint via Cloudflare's
// retry semantics would be a nice-to-have; for now we use one.
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'

interface OverpassWay {
  type: 'way'
  id: number
  geometry?: Array<{ lat: number; lon: number }>
  tags?: Record<string, string>
}

interface OverpassResponse {
  elements?: OverpassWay[]
}

export const onRequestPost: PagesFunction = async (context) => {
  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { west, south, east, north } = (body ?? {}) as Record<string, unknown>
  const bbox = validateBbox(west, south, east, north)
  if (!bbox) return Response.json({ error: 'Invalid bbox' }, { status: 400 })

  // Overpass query: ways with a `highway` tag, with full geometry, inside
  // the bbox. `(south,west,north,east)` is the Overpass bbox order.
  const query = `[out:json][timeout:25];
way[highway](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
out geom;`

  let resp: Response
  try {
    resp = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: query,
      // 1-hour edge cache.
      cf: { cacheTtl: 3600, cacheEverything: true },
    })
  } catch (err) {
    console.error('[roads] Overpass fetch threw', err)
    return Response.json({ error: 'Upstream unreachable' }, { status: 502 })
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    console.error('[roads] Overpass', resp.status, detail.slice(0, 500))
    return Response.json({ error: 'Upstream error' }, { status: 502 })
  }

  const data = (await resp.json()) as OverpassResponse
  const elements = data.elements ?? []
  // Convert each Way's geometry array into a GeoJSON LineString. Skip
  // ways missing geometry (Overpass omits it on filtered-out fields).
  const features: unknown[] = []
  for (const w of elements) {
    if (w.type !== 'way' || !Array.isArray(w.geometry) || w.geometry.length < 2) continue
    const coords = w.geometry
      .map((p): [number, number] | null => {
        if (typeof p.lon !== 'number' || typeof p.lat !== 'number') return null
        if (!Number.isFinite(p.lon) || !Number.isFinite(p.lat)) return null
        return [p.lon, p.lat]
      })
      .filter((c): c is [number, number] => c !== null)
    if (coords.length < 2) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {
        osmId: w.id,
        highway: w.tags?.highway ?? null,
        name: w.tags?.name ?? null,
      },
    })
  }

  return new Response(
    JSON.stringify({ type: 'FeatureCollection', features }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  )
}
