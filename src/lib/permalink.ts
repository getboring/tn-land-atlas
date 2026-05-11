// URL state for the map. Keeps view + selected parcel in the address bar so
// users can bookmark, share, and reload to the same place.
//
//   ?lng=-82.3534&lat=36.3134&z=16          map view
//   ?parcel=090046M%20H%2001300              selected parcel by GISLINK
//
// Public surface:
// - MapViewState, PermalinkState     the shape of view + selection in URL params
// - DEFAULT_MAP_VIEW                 the starting view when no params are present
// - parsePermalink(search)           URL search string -> PermalinkState
// - encodePermalink(state)           PermalinkState -> URL search string
// - updateAddressBar(state)          push via history.replaceState (no nav)
//
// Invariants:
// - Both URL keys are independent. Missing -> use the default for that key.
// - All three of lng/lat/z must be present and finite for a view to apply.
//   Number(null) is 0, so partial-coords would otherwise produce a bogus
//   null-island view at lng=0 lat=0.
// - updates use replaceState (not pushState) so we never pollute browser
//   history with per-pan/zoom entries.

/** A single MapLibre camera state. zoom is in MapLibre's 0..22 scale. */
export interface MapViewState {
  lng: number
  lat: number
  zoom: number
}

/** Parsed URL state. Either field may be null when not present in the URL. */
export interface PermalinkState {
  view: MapViewState | null
  parcelKey: string | null
}

const DEFAULT_VIEW: MapViewState = { lng: -82.35, lat: 36.35, zoom: 11 }

/**
 * Default starting view (Tri-Cities TN). Used when no `?lng=&lat=&z=`
 * params are present in the URL.
 */
export const DEFAULT_MAP_VIEW = DEFAULT_VIEW

/**
 * Parse `window.location.search` (or any URL search string) into the
 * structured permalink shape used by ParcelMap.
 *
 * @param search The search portion of a URL, including the leading `?`
 *   (URLSearchParams accepts both forms).
 * @returns A {@link PermalinkState} whose `view` is null when any of the
 *   three coordinate params are missing, non-finite, or zoom is outside
 *   `[0, 22]`. `parcelKey` is null when the `parcel` param is missing or
 *   empty.
 */
export function parsePermalink(search: string): PermalinkState {
  const params = new URLSearchParams(search)
  const lngRaw = params.get('lng')
  const latRaw = params.get('lat')
  const zRaw = params.get('z')
  let view: MapViewState | null = null
  if (lngRaw && latRaw && zRaw) {
    const lng = Number(lngRaw)
    const lat = Number(latRaw)
    const z = Number(zRaw)
    if (Number.isFinite(lng) && Number.isFinite(lat) && Number.isFinite(z) && z >= 0 && z <= 22) {
      view = { lng, lat, zoom: z }
    }
  }
  const parcelKey = params.get('parcel') || null
  return { view, parcelKey }
}

/**
 * Serialize a {@link PermalinkState} into a URL search string (with the
 * leading `?`), or the pathname alone when there's no state to encode.
 *
 * Coordinates are fixed at 5 decimals (~1.1 m precision at TN latitudes);
 * zoom is fixed at 2 decimals. Lossy round-trip is intentional — shorter
 * URLs are easier to share and the lost precision is below visible map
 * resolution.
 */
export function encodePermalink(state: PermalinkState): string {
  const params = new URLSearchParams()
  if (state.view) {
    params.set('lng', state.view.lng.toFixed(5))
    params.set('lat', state.view.lat.toFixed(5))
    params.set('z', state.view.zoom.toFixed(2))
  }
  if (state.parcelKey) params.set('parcel', state.parcelKey)
  const qs = params.toString()
  return qs ? `?${qs}` : window.location.pathname
}

/**
 * Sync the address bar to the current map state without adding to browser
 * history. Caller passes the full state on every change; this function
 * skips the write when the URL already matches.
 *
 * Uses `history.replaceState` so panning the map doesn't fill the back
 * stack with hundreds of intermediate views.
 */
export function updateAddressBar(state: PermalinkState): void {
  const next = encodePermalink(state)
  const current = window.location.search || window.location.pathname
  if (next !== current && next !== window.location.search) {
    window.history.replaceState(null, '', next)
  }
}
