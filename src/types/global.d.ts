import type maplibregl from 'maplibre-gl'

declare global {
  interface Window {
    // Exposed by ParcelMap for E2E tests. Do not consume in app code.
    __map__?: maplibregl.Map
  }
}

export {}
