// Ruler tool: Terra Draw linestring mode wrapper.
//
// We use Terra Draw only for the distance-measurement ruler. The lasso
// (polygon selection) was retired — Holston Scout is parcel-by-parcel
// intelligence, not bulk selection.
//
// Public surface:
// - DrawMode                 'idle' | 'ruler'
// - DrawHandlers             onLineComplete callback bundle
// - createDraw(map, h)       returns a wired TerraDraw instance
// - setDrawMode(draw, mode)  switches modes; 'idle' clears in-progress drawings
// - lineDistanceMeters(line) haversine sum along a multi-point line
// - formatDistance(meters)   feet under 1 mile; miles with 2-decimal precision above

import type maplibregl from 'maplibre-gl'
import { TerraDraw, TerraDrawLineStringMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'

/** The two states the Terra Draw instance can occupy. */
export type DrawMode = 'idle' | 'ruler'

/** Completion callback for the ruler mode. */
export interface DrawHandlers {
  /** Ordered `[lng, lat][]` line. At least two points. */
  onLineComplete: (line: [number, number][]) => void
}

/**
 * Construct the single TerraDraw instance for the lifetime of a map.
 *
 * Handlers are wired once at construction. To change behavior later,
 * recreate the instance instead of mutating callbacks; Terra Draw doesn't
 * support handler replacement after `on('finish')`.
 */
export function createDraw(map: maplibregl.Map, handlers: DrawHandlers): TerraDraw {
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new TerraDrawLineStringMode({
        // Copper-bright — measurement isn't a commit, just a readout.
        styles: {
          lineStringColor: '#FCD34D',
          lineStringWidth: 3,
        },
      }),
    ],
  })

  draw.on('finish', (id) => {
    const all = draw.getSnapshot()
    const f = all.find((x) => x.id === id)
    if (!f) return
    if (f.geometry.type === 'LineString') {
      const line = f.geometry.coordinates as [number, number][]
      handlers.onLineComplete(line)
    }
  })

  return draw
}

/**
 * Switch the active Terra Draw mode.
 *
 * `'idle'` clears any in-progress drawings so leaving an unfinished line
 * doesn't linger on the map.
 */
export function setDrawMode(draw: TerraDraw, mode: DrawMode): void {
  if (mode === 'idle') {
    draw.setMode('static')
    draw.clear()
  } else if (mode === 'ruler') {
    draw.setMode('linestring')
  }
}

/** Haversine great-circle distance between two `[lng, lat]` points, in meters. */
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

/**
 * Sum of consecutive haversine segments along a multi-point line.
 * Returns 0 for a single-point or empty input.
 */
export function lineDistanceMeters(line: [number, number][]): number {
  let total = 0
  for (let i = 1; i < line.length; i++) {
    total += haversineMeters(line[i - 1], line[i])
  }
  return total
}

const FEET_PER_METER = 3.28084
const FEET_PER_MILE = 5280

/**
 * Format a meter distance for the ruler readout.
 *
 * @example
 * formatDistance(100)    // -> '328 ft'
 * formatDistance(2000)   // -> '6,562 ft'
 * formatDistance(3000)   // -> '1.86 mi'
 */
export function formatDistance(meters: number): string {
  const feet = meters * FEET_PER_METER
  if (feet < FEET_PER_MILE) return `${Math.round(feet).toLocaleString()} ft`
  return `${(feet / FEET_PER_MILE).toFixed(2)} mi`
}
