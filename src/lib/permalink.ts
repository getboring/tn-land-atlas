// URL state for the map. Keeps view + selected parcel in the address bar so
// users can bookmark, share, and reload to the same place.
//
//   ?lng=-82.3534&lat=36.3134&z=16          map view
//   ?parcel=090046M%20H%2001300              selected parcel by GISLINK
//
// Both keys are independent. Missing -> use defaults.

export interface MapViewState {
  lng: number
  lat: number
  zoom: number
}

export interface PermalinkState {
  view: MapViewState | null
  parcelKey: string | null
}

const DEFAULT_VIEW: MapViewState = { lng: -82.35, lat: 36.35, zoom: 11 }

export const DEFAULT_MAP_VIEW = DEFAULT_VIEW

export function parsePermalink(search: string): PermalinkState {
  const params = new URLSearchParams(search)
  const lngRaw = params.get('lng')
  const latRaw = params.get('lat')
  const zRaw = params.get('z')
  // Require all three params to be present. Number(null) -> 0 which would
  // otherwise sneak past the isFinite check and produce a bogus null-island
  // view at lng=0 lat=0.
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

export function updateAddressBar(state: PermalinkState): void {
  const next = encodePermalink(state)
  const current = window.location.search || window.location.pathname
  if (next !== current && next !== window.location.search) {
    // replaceState so we don't pollute browser history with every pan/zoom
    window.history.replaceState(null, '', next)
  }
}
