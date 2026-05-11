// Terra Draw lifecycle helpers.
//
// Wraps the Terra Draw + MapLibre adapter boilerplate so ParcelMap.tsx
// only deals with the high-level mode + completion callbacks. There is
// exactly one TerraDraw instance per map; lasso (polygon) and ruler
// (linestring) modes share it.
//
// Public surface:
// - DrawMode                 'idle' | 'lasso' | 'ruler'
// - DrawHandlers             callback bundle the host supplies once at create time
// - createDraw(map, h)       returns a fully-wired TerraDraw
// - setDrawMode(draw, mode)  switches the active mode; 'idle' also clears in-progress drawings
// - lineDistanceMeters(line) sum of haversine segments along a multi-point line
// - formatDistance(meters)   feet under 1 mile, miles with 2-decimal precision above
//
// Gotcha: setDrawMode('idle') CLEARS all drawings. If build-fit ever
// needs a parallel draw instance, fork it; do not share this one.

import type maplibregl from 'maplibre-gl'
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawLineStringMode,
} from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'

/** The three states the Terra Draw instance can occupy. */
export type DrawMode = 'idle' | 'lasso' | 'ruler'

/**
 * Completion callbacks for the two interactive modes. Both fire on
 * `finish`; the caller decides what to do with the resulting geometry
 * (lasso -> spatial query, ruler -> distance readout).
 */
export interface DrawHandlers {
  /** Closed polygon ring as `[lng, lat][]`. First and last points are equal. */
  onPolygonComplete: (ring: [number, number][]) => void
  /** Ordered `[lng, lat][]` line. At least two points. */
  onLineComplete: (line: [number, number][]) => void
}

/**
 * Construct the single TerraDraw instance for the lifetime of a map.
 *
 * The handlers are wired once at construction. To change behavior later,
 * recreate the instance instead of mutating callbacks; Terra Draw doesn't
 * support handler replacement after `on('finish')`.
 *
 * Style colors mirror the brand selection language so the in-progress
 * lasso reads as "this is selection-in-flight" without a legend.
 */
export function createDraw(map: maplibregl.Map, handlers: DrawHandlers): TerraDraw {
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new TerraDrawPolygonMode({
        // Holston copper — same selection language used by parcels-selected.
        // The lasso is "in-progress selection" so it shares that visual.
        styles: {
          fillColor: '#F59E0B',
          fillOpacity: 0.15,
          outlineColor: '#F59E0B',
          outlineWidth: 2,
          closingPointColor: '#F59E0B',
          closingPointOutlineColor: '#F59E0B',
          closingPointWidth: 2,
        },
      }),
      new TerraDrawLineStringMode({
        // Copper-bright — distinct from selection (the line isn't a commit,
        // it's a measurement). Same warm family, brighter saturation.
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

/**
 * Switch the active Terra Draw mode.
 *
 * `'idle'` clears any in-progress drawings — both lasso and ruler share
 * one instance, so leaving an in-progress polygon visible while the user
 * starts the ruler would be confusing.
 */
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
