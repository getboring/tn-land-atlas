// Terra Draw lifecycle helpers. Keeps ParcelMap.tsx free of the adapter
// boilerplate so the component focuses on app behavior.

import type maplibregl from 'maplibre-gl'
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawLineStringMode,
} from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'

export type DrawMode = 'idle' | 'lasso' | 'ruler'

export interface DrawHandlers {
  onPolygonComplete: (ring: [number, number][]) => void
  onLineComplete: (line: [number, number][]) => void
}

export function createDraw(map: maplibregl.Map, handlers: DrawHandlers): TerraDraw {
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new TerraDrawPolygonMode({
        // Holston copper — same selection language used by parcels-selected.
        // The lasso is "in-progress selection" so it shares that visual.
        styles: {
          fillColor: '#B8732E',
          fillOpacity: 0.15,
          outlineColor: '#B8732E',
          outlineWidth: 2,
          closingPointColor: '#B8732E',
          closingPointOutlineColor: '#B8732E',
          closingPointWidth: 2,
        },
      }),
      new TerraDrawLineStringMode({
        // Copper-bright — distinct from selection (the line isn't a commit,
        // it's a measurement). Same warm family, brighter saturation.
        styles: {
          lineStringColor: '#D4882F',
          lineStringWidth: 3,
        },
      }),
    ],
  })

  draw.on('finish', (id) => {
    const all = draw.getSnapshot()
    const f = all.find((x) => x.id === id)
    if (!f) return
    const t = f.geometry.type
    if (t === 'Polygon') {
      const ring = (f.geometry.coordinates as number[][][])[0] as [number, number][]
      handlers.onPolygonComplete(ring)
    } else if (t === 'LineString') {
      const line = f.geometry.coordinates as [number, number][]
      handlers.onLineComplete(line)
    }
  })

  return draw
}

export function setDrawMode(draw: TerraDraw, mode: DrawMode): void {
  if (mode === 'idle') {
    draw.setMode('static')
    draw.clear()
  } else if (mode === 'lasso') {
    draw.setMode('polygon')
  } else if (mode === 'ruler') {
    draw.setMode('linestring')
  }
}

// Haversine distance between two [lng, lat] points, in meters.
function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(x))
}

export function lineDistanceMeters(line: [number, number][]): number {
  let total = 0
  for (let i = 1; i < line.length; i++) {
    total += haversineMeters(line[i - 1], line[i])
  }
  return total
}

const FEET_PER_METER = 3.28084
const FEET_PER_MILE = 5280

export function formatDistance(meters: number): string {
  const feet = meters * FEET_PER_METER
  if (feet < FEET_PER_MILE) return `${Math.round(feet).toLocaleString()} ft`
  return `${(feet / FEET_PER_MILE).toFixed(2)} mi`
}
