// Ambient global declarations.
//
// Only `window.__map__` lives here right now: the MapLibre instance is
// attached to window by ParcelMap so Playwright tests can call
// `m.jumpTo`, `m.queryRenderedFeatures`, `m.querySourceFeatures`, etc.
// directly from `page.evaluate`. App code MUST NOT read this; the map
// flows via React state and refs everywhere else.

import type maplibregl from 'maplibre-gl'

declare global {
  interface Window {
    /**
     * E2E-only handle on the MapLibre instance. Set in ParcelMap.tsx
     * on map load; do not read from app code.
     */
    __map__?: maplibregl.Map
  }
}

export {}
