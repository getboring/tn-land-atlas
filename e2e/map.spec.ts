import { test, expect, type Page } from '@playwright/test'

const PARCEL_API = /\/api\/parcels|\/ParcelPublishing\/TaxParcels\/MapServer\/0\/query/

async function waitForMapReady(page: Page) {
  await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __map__?: { loaded?: () => boolean } }).__map__
      return !!m && typeof m.loaded === 'function' && m.loaded()
    },
    { timeout: 20000 }
  )
}

async function loadParcelsAt(page: Page, lng: number, lat: number, zoom: number) {
  const respPromise = page.waitForResponse(
    (r) => PARCEL_API.test(r.url()) && r.status() === 200,
    { timeout: 25000 }
  )
  await page.evaluate(
    ([lngArg, latArg, zoomArg]) => {
      const m = (window as unknown as { __map__?: { jumpTo: (o: object) => void } }).__map__
      if (m) m.jumpTo({ center: [lngArg, latArg], zoom: zoomArg })
    },
    [lng, lat, zoom] as const
  )
  await respPromise

  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          const m = (
            window as unknown as {
              __map__?: { queryRenderedFeatures: (g: undefined, o: object) => unknown[] }
            }
          ).__map__
          if (!m) return 0
          return m.queryRenderedFeatures(undefined, { layers: ['parcels-fill'] }).length
        }),
      { timeout: 20000, intervals: [500, 1000, 2000] }
    )
    .toBeGreaterThan(0)
}

async function clickFirstParcel(page: Page) {
  // Center the map on a parcel's centroid, then click canvas center.
  // Centering avoids any overlap with top-bar/sidebar controls and guarantees
  // queryRenderedFeatures and the actual hit-test agree.
  const centered = await page.evaluate(() => {
    type Coord = [number, number]
    const m = (
      window as unknown as {
        __map__?: {
          queryRenderedFeatures: (p: undefined, o: object) => Array<{
            geometry: { type: string; coordinates: Coord[][] | Coord[][][] }
          }>
          jumpTo: (o: object) => void
        }
      }
    ).__map__
    if (!m) return null
    const feats = m.queryRenderedFeatures(undefined, { layers: ['parcels-fill'] })
    if (feats.length === 0) return null
    const ring = (feats[0].geometry.type === 'MultiPolygon'
      ? (feats[0].geometry.coordinates as Coord[][][])[0][0]
      : (feats[0].geometry.coordinates as Coord[][])[0]) as Coord[]
    let lng = 0
    let lat = 0
    for (const [x, y] of ring) {
      lng += x
      lat += y
    }
    lng /= ring.length
    lat /= ring.length
    m.jumpTo({ center: [lng, lat], zoom: 18 })
    return { lng, lat }
  })
  if (!centered) throw new Error('No parcel found in viewport to click')
  // Wait a beat for moveend + render to settle at the new zoom
  await page.waitForLoadState('networkidle').catch(() => undefined)
  const canvas = page.locator('canvas.maplibregl-canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Canvas not found')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

test.describe('TN Land Atlas', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)
  })

  test('map loads with title and controls', async ({ page }) => {
    await expect(page.getByText('TN Land Atlas')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-zoom-out')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-fullscreen')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-geolocate')).toBeVisible()
  })

  test('map container fills the viewport', async ({ page }) => {
    const dims = await page.evaluate(() => {
      const m = (window as unknown as { __map__?: { getContainer: () => HTMLElement; getCanvas: () => HTMLCanvasElement } }).__map__
      if (!m) return null
      const c = m.getContainer()
      const canvas = m.getCanvas()
      return {
        containerH: c.clientHeight,
        canvasH: canvas.clientHeight,
        viewportH: window.innerHeight,
      }
    })
    expect(dims).not.toBeNull()
    // Container must occupy more than half the viewport — guards against
    // CSS regressions that collapse the map to height: 0.
    expect(dims!.containerH).toBeGreaterThan(dims!.viewportH * 0.6)
    expect(dims!.canvasH).toBeGreaterThan(dims!.viewportH * 0.6)
  })

  test('county filter pills are visible and clickable', async ({ page }) => {
    for (const county of ['All', 'Sullivan', 'Washington', 'Carter']) {
      await expect(page.getByRole('button', { name: county, exact: false })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Sullivan', exact: false }).click()
    await expect(page.getByRole('button', { name: 'Sullivan', exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'All', exact: false }).first().click()
  })

  test('search input exists and accepts text', async ({ page }) => {
    const input = page.getByPlaceholder('Search owner or address…')
    await expect(input).toBeVisible()
    await input.fill('123 main')
    await expect(input).toHaveValue('123 main')
  })

  test('search shows a results list and picking one opens detail', async ({ page }) => {
    const input = page.getByPlaceholder('Search owner or address…')
    await input.fill('smith')
    const searchResp = page.waitForResponse(
      (r) => r.url().includes('/api/search') && r.status() === 200,
      { timeout: 25000 },
    )
    await input.press('Enter')
    await searchResp
    const heading = page.getByRole('heading', { name: /^(\d+ match(es)?|No matches)$/ })
    await expect(heading).toBeVisible({ timeout: 15000 })
    const firstResult = page.locator('ul li button').first()
    if (await firstResult.count()) {
      await firstResult.click()
      await expect(page.getByText('Property Details')).toBeVisible({ timeout: 8000 })
      // Results panel heading should be gone
      await expect(heading).toHaveCount(0)
    }
  })

  test('clear-search button empties the input and closes results', async ({ page }) => {
    const input = page.getByPlaceholder('Search owner or address…')
    await input.fill('hello')
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(input).toHaveValue('')
  })

  test('base layer toggle switches between Esri and NAIP', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /^(NAIP|Esri)$/ })
    await expect(toggle).toBeVisible()
    const before = await toggle.textContent()
    await toggle.click()
    await expect(toggle).not.toHaveText(before ?? '')
  })

  test('parcel visibility toggle works', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /^(Hide|Show)$/ })
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(page.getByRole('button', { name: 'Show', exact: true })).toBeVisible()
    await toggle.click()
    await expect(page.getByRole('button', { name: 'Hide', exact: true })).toBeVisible()
  })

  test('zooming in loads parcel polygons', async ({ page }) => {
    await loadParcelsAt(page, -82.3534, 36.3134, 15)
    await expect(page.getByText(/parcels visible/)).toBeVisible({ timeout: 10000 })
  })

  test('clicking a parcel opens detail sidebar', async ({ page }) => {
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await expect(page.getByText('Property Details')).toBeVisible({ timeout: 8000 })
  })

  test('detail sidebar can be closed', async ({ page }) => {
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await expect(page.getByText('Property Details')).toBeVisible({ timeout: 8000 })
    await page.locator('button').filter({ has: page.locator('svg.lucide-x') }).click()
    await expect(page.getByText('Property Details')).not.toBeVisible()
  })

  test('responsive layout adapts to viewport', async ({ page }) => {
    await expect(page.getByText('TN Land Atlas')).toBeVisible()
    await expect(page.getByPlaceholder('Search owner or address…')).toBeVisible()
  })

  test('recenter button resets view', async ({ page }) => {
    await page.evaluate(() => {
      const m = (window as unknown as { __map__?: { jumpTo: (o: object) => void } }).__map__
      if (m) m.jumpTo({ center: [-82.3534, 36.3134], zoom: 16 })
    })
    const recenter = page.locator('button').filter({ has: page.locator('svg.lucide-crosshair') })
    await recenter.click()
    await expect
      .poll(async () =>
        await page.evaluate(() => {
          const m = (
            window as unknown as {
              __map__?: { getZoom: () => number }
            }
          ).__map__
          return m ? m.getZoom() : 0
        })
      , { timeout: 5000 })
      .toBeLessThan(13)
  })
})
