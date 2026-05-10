import { describe, it, expect, beforeEach } from 'vitest'
import {
  installFitLayers,
  updateFitLayers,
  clearFitLayers,
  uninstallFitLayers,
  FIT_SOURCE_IDS,
  FIT_LAYER_IDS_BOTTOM_TO_TOP,
  type FitMapTarget,
  type FitLayerSpec,
} from './map-layers'

// ── MockMap ────────────────────────────────────────────────────────────────
// Records every call. Implements only the methods map-layers actually uses.
// Layer order tracking lets us assert the install sequence is bottom -> top.

interface RecordedCall {
  op: 'addSource' | 'addLayer' | 'removeSource' | 'removeLayer' | 'setData'
  id: string
  beforeId?: string
}

class MockMap implements FitMapTarget {
  sources = new Map<string, { type: 'geojson'; data: GeoJSON.FeatureCollection }>()
  layers = new Map<string, FitLayerSpec>()
  layerOrder: string[] = []
  /** Layers from the "host" style — pretend the parcel layers are already there. */
  preexistingLayers: string[] = []
  calls: RecordedCall[] = []
  sourceData = new Map<string, GeoJSON.FeatureCollection>()

  addSource(id: string, spec: { type: 'geojson'; data: GeoJSON.FeatureCollection }): void {
    if (this.sources.has(id)) throw new Error(`addSource: ${id} already exists`)
    this.sources.set(id, spec)
    this.sourceData.set(id, spec.data)
    this.calls.push({ op: 'addSource', id })
  }
  getSource(id: string): { setData: (d: GeoJSON.FeatureCollection) => void } | undefined {
    if (!this.sources.has(id)) return undefined
    return {
      setData: (d) => {
        this.sourceData.set(id, d)
        this.calls.push({ op: 'setData', id })
      },
    }
  }
  removeSource(id: string): void {
    if (!this.sources.has(id)) throw new Error(`removeSource: ${id} not found`)
    this.sources.delete(id)
    this.sourceData.delete(id)
    this.calls.push({ op: 'removeSource', id })
  }
  addLayer(spec: FitLayerSpec, beforeId?: string): void {
    if (this.layers.has(spec.id)) throw new Error(`addLayer: ${spec.id} already exists`)
    this.layers.set(spec.id, spec)
    if (beforeId && this.layerOrder.includes(beforeId)) {
      const idx = this.layerOrder.indexOf(beforeId)
      this.layerOrder.splice(idx, 0, spec.id)
    } else if (beforeId && this.preexistingLayers.includes(beforeId)) {
      // Preexisting host layer is the anchor — fit layers stack just below it.
      this.layerOrder.push(spec.id)
    } else {
      this.layerOrder.push(spec.id)
    }
    this.calls.push({ op: 'addLayer', id: spec.id, beforeId })
  }
  getLayer(id: string): { id: string } | undefined {
    if (this.layers.has(id)) return { id }
    if (this.preexistingLayers.includes(id)) return { id }
    return undefined
  }
  removeLayer(id: string): void {
    if (!this.layers.has(id)) throw new Error(`removeLayer: ${id} not found`)
    this.layers.delete(id)
    this.layerOrder = this.layerOrder.filter((x) => x !== id)
    this.calls.push({ op: 'removeLayer', id })
  }
  getStyle(): { layers: Array<{ id: string }> } {
    return { layers: [...this.preexistingLayers, ...this.layerOrder].map((id) => ({ id })) }
  }
}

let map: MockMap
beforeEach(() => {
  map = new MockMap()
  // Pretend the host has these layers already, mirroring ParcelMap.tsx state.
  map.preexistingLayers = [
    'esri-imagery',
    'parcels-line',
    'parcels-hover',
    'parcels-selected',
    'parcels-selected-fill',
    'parcel-corners',
  ]
})

// ── Source / layer ids ────────────────────────────────────────────────────

describe('fit ids', () => {
  it('every source id is fit-* prefixed', () => {
    for (const id of Object.values(FIT_SOURCE_IDS)) {
      expect(id.startsWith('fit-')).toBe(true)
    }
  })
  it('every layer id is fit-* prefixed', () => {
    for (const id of FIT_LAYER_IDS_BOTTOM_TO_TOP) {
      expect(id.startsWith('fit-')).toBe(true)
    }
  })
  it('FIT_SOURCE_IDS values are unique', () => {
    const arr = Object.values(FIT_SOURCE_IDS)
    expect(new Set(arr).size).toBe(arr.length)
  })
  it('FIT_LAYER_IDS_BOTTOM_TO_TOP values are unique', () => {
    const arr = [...FIT_LAYER_IDS_BOTTOM_TO_TOP]
    expect(new Set(arr).size).toBe(arr.length)
  })
})

// ── installFitLayers ──────────────────────────────────────────────────────

describe('installFitLayers', () => {
  it('adds every fit source', () => {
    installFitLayers(map)
    for (const id of Object.values(FIT_SOURCE_IDS)) {
      expect(map.sources.has(id)).toBe(true)
    }
  })

  it('adds every fit layer', () => {
    installFitLayers(map)
    for (const id of FIT_LAYER_IDS_BOTTOM_TO_TOP) {
      expect(map.layers.has(id)).toBe(true)
    }
  })

  it('installs layers bottom -> top in declared z-order', () => {
    installFitLayers(map)
    // Filter the recorded order to fit-* layers only.
    const fitOrder = map.layerOrder.filter((id) => id.startsWith('fit-'))
    expect(fitOrder).toEqual([...FIT_LAYER_IDS_BOTTOM_TO_TOP])
  })

  it('is idempotent — calling twice does not throw or duplicate', () => {
    installFitLayers(map)
    const firstCallCount = map.calls.length
    expect(() => installFitLayers(map)).not.toThrow()
    // Second call should add ZERO new sources/layers.
    const secondCallCount = map.calls.length
    expect(secondCallCount).toBe(firstCallCount)
    expect(map.sources.size).toBe(Object.values(FIT_SOURCE_IDS).length)
    expect(map.layers.size).toBe(FIT_LAYER_IDS_BOTTOM_TO_TOP.length)
  })

  it('honors beforeId when the anchor exists in the host style', () => {
    installFitLayers(map, { beforeId: 'parcel-corners' })
    // Every addLayer should carry the beforeId.
    const addLayerCalls = map.calls.filter((c) => c.op === 'addLayer')
    for (const call of addLayerCalls) {
      expect(call.beforeId).toBe('parcel-corners')
    }
  })

  it('falls back to top-of-stack when beforeId is unknown', () => {
    installFitLayers(map, { beforeId: 'nonexistent-layer-name' })
    // resolveBeforeId should have produced undefined; addLayer carries no anchor.
    const addLayerCalls = map.calls.filter((c) => c.op === 'addLayer')
    for (const call of addLayerCalls) {
      expect(call.beforeId).toBeUndefined()
    }
  })

  it('initializes every fit source as an empty FeatureCollection', () => {
    installFitLayers(map)
    for (const id of Object.values(FIT_SOURCE_IDS)) {
      expect(map.sourceData.get(id)).toEqual({ type: 'FeatureCollection', features: [] })
    }
  })
})

// ── updateFitLayers ──────────────────────────────────────────────────────

const samplePolygon: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [[-82.35, 36.31], [-82.34, 36.31], [-82.34, 36.32], [-82.35, 36.32], [-82.35, 36.31]],
  ],
}

describe('updateFitLayers', () => {
  beforeEach(() => {
    installFitLayers(map)
    map.calls = [] // reset to study only update calls
  })

  it('writes footprint via setData with valid:true property', () => {
    updateFitLayers(map, { footprint: { geometry: samplePolygon, valid: true } })
    const data = map.sourceData.get(FIT_SOURCE_IDS.footprint)
    expect(data?.features).toHaveLength(1)
    expect((data?.features[0]?.properties as { valid: boolean }).valid).toBe(true)
  })

  it('writes footprint with valid:false for conflict styling', () => {
    updateFitLayers(map, { footprint: { geometry: samplePolygon, valid: false } })
    const data = map.sourceData.get(FIT_SOURCE_IDS.footprint)
    expect((data?.features[0]?.properties as { valid: boolean }).valid).toBe(false)
  })

  it('null clears the footprint source to empty FC', () => {
    updateFitLayers(map, { footprint: { geometry: samplePolygon, valid: true } })
    updateFitLayers(map, { footprint: null })
    expect(map.sourceData.get(FIT_SOURCE_IDS.footprint)?.features).toEqual([])
  })

  it('undefined fields leave the source untouched', () => {
    updateFitLayers(map, { footprint: { geometry: samplePolygon, valid: true } })
    const before = map.sourceData.get(FIT_SOURCE_IDS.footprint)
    updateFitLayers(map, {}) // every key undefined
    const after = map.sourceData.get(FIT_SOURCE_IDS.footprint)
    expect(after).toBe(before)
  })

  it('writes envelope as a single Polygon feature', () => {
    updateFitLayers(map, { envelope: samplePolygon })
    const data = map.sourceData.get(FIT_SOURCE_IDS.envelope)
    expect(data?.features).toHaveLength(1)
    expect(data?.features[0]?.geometry.type).toBe('Polygon')
  })

  it('writes envelope MultiPolygon as a single feature', () => {
    const mp: GeoJSON.MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [samplePolygon.coordinates, samplePolygon.coordinates],
    }
    updateFitLayers(map, { envelope: mp })
    const data = map.sourceData.get(FIT_SOURCE_IDS.envelope)
    expect(data?.features[0]?.geometry.type).toBe('MultiPolygon')
  })

  it('passes pre-built FeatureCollections through for setbackLines / conflicts / handles / labels', () => {
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-82.35, 36.31] }, properties: { label: '40 ft' } },
      ],
    }
    updateFitLayers(map, {
      setbackLines: { type: 'FeatureCollection', features: [] },
      conflicts: { type: 'FeatureCollection', features: [] },
      handles: fc as GeoJSON.FeatureCollection<GeoJSON.Point>,
      labels: fc as GeoJSON.FeatureCollection<GeoJSON.Point>,
    })
    expect(map.sourceData.get(FIT_SOURCE_IDS.handles)?.features).toHaveLength(1)
    expect(map.sourceData.get(FIT_SOURCE_IDS.labels)?.features).toHaveLength(1)
  })

  it('only emits setData calls — never addLayer or removeLayer', () => {
    updateFitLayers(map, {
      footprint: { geometry: samplePolygon, valid: true },
      envelope: samplePolygon,
    })
    const ops = new Set(map.calls.map((c) => c.op))
    expect(ops.has('setData')).toBe(true)
    expect(ops.has('addLayer')).toBe(false)
    expect(ops.has('removeLayer')).toBe(false)
    expect(ops.has('addSource')).toBe(false)
    expect(ops.has('removeSource')).toBe(false)
  })
})

// ── clearFitLayers ────────────────────────────────────────────────────────

describe('clearFitLayers', () => {
  beforeEach(() => {
    installFitLayers(map)
    updateFitLayers(map, {
      footprint: { geometry: samplePolygon, valid: true },
      envelope: samplePolygon,
    })
    map.calls = []
  })

  it('empties every fit source', () => {
    clearFitLayers(map)
    for (const id of Object.values(FIT_SOURCE_IDS)) {
      expect(map.sourceData.get(id)?.features).toEqual([])
    }
  })

  it('does not remove any source or layer', () => {
    clearFitLayers(map)
    expect(map.sources.size).toBe(Object.values(FIT_SOURCE_IDS).length)
    expect(map.layers.size).toBe(FIT_LAYER_IDS_BOTTOM_TO_TOP.length)
    const removeOps = map.calls.filter((c) => c.op === 'removeSource' || c.op === 'removeLayer')
    expect(removeOps).toHaveLength(0)
  })

  it('does not touch any non-fit-* source/layer', () => {
    clearFitLayers(map)
    // Preexisting host layers untouched.
    for (const id of map.preexistingLayers) {
      expect(map.layers.has(id)).toBe(false) // the mock never added them as fit layers
      expect(map.sources.has(id)).toBe(false) // and the mock never registered them as sources
    }
    // No setData call addressed a non-fit-* source.
    for (const call of map.calls.filter((c) => c.op === 'setData')) {
      expect(call.id.startsWith('fit-')).toBe(true)
    }
  })
})

// ── uninstallFitLayers ────────────────────────────────────────────────────

describe('uninstallFitLayers', () => {
  it('removes layers top -> bottom and then sources', () => {
    installFitLayers(map)
    map.calls = []
    uninstallFitLayers(map)

    const removeLayerCalls = map.calls.filter((c) => c.op === 'removeLayer').map((c) => c.id)
    expect(removeLayerCalls).toEqual([...FIT_LAYER_IDS_BOTTOM_TO_TOP].reverse())

    expect(map.layers.size).toBe(0)
    expect(map.sources.size).toBe(0)
  })

  it('is safe to call when nothing was installed', () => {
    expect(() => uninstallFitLayers(map)).not.toThrow()
  })

  it('install -> uninstall -> install round-trip works', () => {
    installFitLayers(map)
    uninstallFitLayers(map)
    expect(() => installFitLayers(map)).not.toThrow()
    expect(map.layers.size).toBe(FIT_LAYER_IDS_BOTTOM_TO_TOP.length)
  })
})
