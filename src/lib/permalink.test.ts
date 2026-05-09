import { describe, it, expect, beforeEach } from 'vitest'
import { parsePermalink, encodePermalink, updateAddressBar, DEFAULT_MAP_VIEW } from './permalink'

describe('parsePermalink', () => {
  it('returns null view + null parcelKey for empty search', () => {
    expect(parsePermalink('')).toEqual({ view: null, parcelKey: null })
  })
  it('parses ?lng=&lat=&z= into a view', () => {
    const r = parsePermalink('?lng=-82.3534&lat=36.3134&z=16')
    expect(r.view).toEqual({ lng: -82.3534, lat: 36.3134, zoom: 16 })
    expect(r.parcelKey).toBeNull()
  })
  it('rejects non-numeric coordinates', () => {
    expect(parsePermalink('?lng=abc&lat=36&z=11').view).toBeNull()
    expect(parsePermalink('?lng=&lat=&z=').view).toBeNull()
  })
  it('rejects out-of-range zoom', () => {
    expect(parsePermalink('?lng=-82&lat=36&z=-1').view).toBeNull()
    expect(parsePermalink('?lng=-82&lat=36&z=23').view).toBeNull()
  })
  it('parses ?parcel= into parcelKey', () => {
    expect(parsePermalink('?parcel=090046M%20H%2001300').parcelKey).toBe('090046M H 01300')
  })
  it('parses parcel + view together', () => {
    const r = parsePermalink('?lng=-82&lat=36&z=15&parcel=ABC')
    expect(r.view).toEqual({ lng: -82, lat: 36, zoom: 15 })
    expect(r.parcelKey).toBe('ABC')
  })
  it('treats empty parcel value as null', () => {
    expect(parsePermalink('?parcel=').parcelKey).toBeNull()
  })
})

describe('encodePermalink', () => {
  it('returns / when both view and parcelKey are null', () => {
    expect(encodePermalink({ view: null, parcelKey: null })).toBe(window.location.pathname)
  })
  it('rounds view coordinates to 5 decimals and zoom to 2', () => {
    const r = encodePermalink({
      view: { lng: -82.353412345, lat: 36.313456789, zoom: 16.123456 },
      parcelKey: null,
    })
    expect(r).toContain('lng=-82.35341')
    expect(r).toContain('lat=36.31346')
    expect(r).toContain('z=16.12')
  })
  it('encodes parcel keys (urlencodes spaces)', () => {
    const r = encodePermalink({ view: null, parcelKey: '090046M H 01300' })
    expect(r).toContain('parcel=090046M+H+01300')
  })
  it('encodes view + parcel together', () => {
    const r = encodePermalink({
      view: { lng: -82, lat: 36, zoom: 15 },
      parcelKey: 'ABC',
    })
    expect(r).toContain('lng=-82.00000')
    expect(r).toContain('lat=36.00000')
    expect(r).toContain('z=15.00')
    expect(r).toContain('parcel=ABC')
  })
})

describe('updateAddressBar', () => {
  beforeEach(() => {
    // jsdom: reset history to a clean ?nothing
    window.history.replaceState(null, '', '/')
  })
  it('writes the new query string via replaceState', () => {
    updateAddressBar({ view: { lng: -82, lat: 36, zoom: 15 }, parcelKey: null })
    expect(window.location.search).toContain('lng=-82.00000')
    expect(window.location.search).toContain('z=15.00')
  })
  it('clears the query string when both view and parcelKey are null', () => {
    window.history.replaceState(null, '', '/?lng=-82.00000&lat=36.00000&z=15.00')
    updateAddressBar({ view: null, parcelKey: null })
    expect(window.location.search).toBe('')
  })
  it('does not push history (replaceState only)', () => {
    const before = window.history.length
    updateAddressBar({ view: { lng: -82, lat: 36, zoom: 15 }, parcelKey: null })
    updateAddressBar({ view: { lng: -83, lat: 37, zoom: 16 }, parcelKey: null })
    updateAddressBar({ view: { lng: -84, lat: 38, zoom: 17 }, parcelKey: null })
    expect(window.history.length).toBe(before)
  })
})

describe('DEFAULT_MAP_VIEW', () => {
  it('exists and is centered on East TN', () => {
    expect(DEFAULT_MAP_VIEW.lng).toBeGreaterThan(-83.5)
    expect(DEFAULT_MAP_VIEW.lng).toBeLessThan(-81.5)
    expect(DEFAULT_MAP_VIEW.lat).toBeGreaterThan(35.5)
    expect(DEFAULT_MAP_VIEW.lat).toBeLessThan(37.0)
    expect(DEFAULT_MAP_VIEW.zoom).toBeGreaterThanOrEqual(0)
    expect(DEFAULT_MAP_VIEW.zoom).toBeLessThanOrEqual(22)
  })
})
