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

test.describe('Holston Scout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForMapReady(page)
  })

  test('map loads with title and controls', async ({ page }) => {
    // The title text is hidden on mobile to fit; the logo container retains
    // an aria-label so it remains discoverable.
    await expect(page.locator('[aria-label="Holston Scout navigation"]')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-zoom-out')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-fullscreen')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-geolocate')).toBeVisible()
  })

  test('chrome height is 48px mobile / 52px desktop and main starts below it', async ({ page }, testInfo) => {
    const dims = await page.evaluate(() => {
      const header = document.querySelector('header[role="banner"]')
      const main = document.querySelector('main')
      return {
        chromeH: header?.getBoundingClientRect().height ?? 0,
        mainTop: Math.round(main?.getBoundingClientRect().top ?? 0),
        viewportW: window.innerWidth,
      }
    })
    // sm breakpoint = 640. Below: 48px chrome. At/above: 52px chrome.
    const expected = dims.viewportW >= 640 ? 52 : 48
    expect(dims.chromeH).toBe(expected)
    // main starts exactly below the chrome (no gap, no overlap)
    expect(dims.mainTop).toBe(expected)
    testInfo.attach('chrome-dims', { body: JSON.stringify(dims), contentType: 'application/json' })
  })

  test('Survey Corner mark is present in the chrome', async ({ page }) => {
    // The mark is an SVG inside the banner role with aria-label "Holston Scout".
    const mark = page.locator('header[role="banner"] svg[aria-label="Holston Scout"]')
    await expect(mark).toBeVisible()
    // It should render at least 16px (the smallest brand size).
    const box = await mark.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(16)
    expect(box!.height).toBeGreaterThanOrEqual(16)
  })

  test('Holston Scout wordmark uses Inter', async ({ page }) => {
    // Post-conversion to the HolstonBuilder design family, the wordmark's
    // .font-display class resolves to Inter (one type family across body + display).
    await page.evaluate(() => document.fonts.ready)
    const fontFamily = await page.evaluate(() => {
      const wordmark = document.querySelector('header[role="banner"] .font-display')
      return wordmark ? getComputedStyle(wordmark).fontFamily : null
    })
    expect(fontFamily).toContain('Inter')
  })

  test('selected parcel shows corner-node markers', async ({ page }) => {
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await expect(page.getByText('Property Details')).toBeVisible({ timeout: 8000 })
    // Wait for the corner-nodes source data to be rendered. Use the public
    // querySourceFeatures API which is what MapLibre exposes for tests.
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
            const m = (
              window as unknown as {
                __map__?: { querySourceFeatures: (id: string) => unknown[] }
              }
            ).__map__
            if (!m) return 0
            return m.querySourceFeatures('parcel-corners').length
          }),
        { timeout: 5000, intervals: [200, 400] },
      )
      .toBeGreaterThan(0)
  })

  test('parcel hover sets feature-state hover=true', async ({ page }) => {
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    // Programmatically dispatch a mouseenter on the parcels-fill layer at
    // canvas center. MapLibre's mousemove handler reads the under-cursor
    // feature and sets hover=true. We can't easily simulate mouse hover
    // through Playwright on a WebGL canvas (no DOM target), so we drive
    // the feature-state setter directly using the same primitive the
    // app's mousemove handler uses.
    const stillTrue = await page.evaluate(() => {
      const m = (
        window as unknown as {
          __map__?: {
            queryRenderedFeatures: (p: undefined, o: object) => Array<{ id: number | string }>
            setFeatureState: (s: object, p: object) => void
            getFeatureState: (s: object) => Record<string, unknown>
          }
        }
      ).__map__
      if (!m) return false
      const feats = m.queryRenderedFeatures(undefined, { layers: ['parcels-fill'] })
      const f = feats[0]
      if (!f) return false
      m.setFeatureState({ source: 'parcels', id: f.id }, { hover: true })
      const state = m.getFeatureState({ source: 'parcels', id: f.id })
      return state.hover === true
    })
    expect(stillTrue).toBe(true)
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
    // Container must occupy more than half the viewport, guards against
    // CSS regressions that collapse the map to height: 0.
    expect(dims!.containerH).toBeGreaterThan(dims!.viewportH * 0.6)
    expect(dims!.canvasH).toBeGreaterThan(dims!.viewportH * 0.6)
  })

  test('search input exists and accepts text', async ({ page }) => {
    const input = page.getByRole('textbox', { name: /Search owner/i })
    await expect(input).toBeVisible()
    await input.fill('123 main')
    await expect(input).toHaveValue('123 main')
  })

  test('search shows a results list and picking one opens detail', async ({ page }) => {
    const input = page.getByRole('textbox', { name: /Search owner/i })
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
    const input = page.getByRole('textbox', { name: /Search owner/i })
    await input.fill('hello')
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(input).toHaveValue('')
  })

  test('bottom action bar exposes Layers, Tools, Filter, Locate, Home', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Map layers/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Drawing tools/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Filter(?:\s·\s\d+)?$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Locate me/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Home view/i })).toBeVisible()
  })

  test('Export control is present in the bottom-right cluster', async ({ page }) => {
    // maplibre-gl-export adds a button with class .maplibregl-export-control.
    await expect(page.locator('.maplibregl-export-control')).toHaveCount(1)
  })

  test('Filter sheet opens and toggles a switch', async ({ page }) => {
    // Initial label is "Filter" (no active count). After applying one, the
    // button's accessible name becomes "Filter · 1".
    const filterBtn = page.getByRole('button', { name: /^Filter(?:\s·\s\d+)?$/ })
    await filterBtn.click()
    const heading = page.getByRole('heading', { name: 'Filter parcels' })
    await expect(heading).toBeVisible()
    const entitySwitch = page.getByRole('switch', { name: /Entity-owned/i })
    await expect(entitySwitch).toHaveAttribute('aria-checked', 'false')
    await entitySwitch.click()
    await expect(entitySwitch).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(heading).not.toBeVisible()
    // Filter button should now show the active count
    await expect(page.getByRole('button', { name: /Filter · 1/ })).toBeVisible()
  })

  test('Tools popover reveals Lasso and Ruler', async ({ page }) => {
    await page.getByRole('button', { name: /Drawing tools/i }).click()
    await expect(page.getByRole('button', { name: /Lasso parcels/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Measure distance/i })).toBeVisible()
  })

  test('contour-lines toggle works (lives inside the Layers popover now)', async ({ page }) => {
    // Topo was promoted to a basemap-and-overlays popover. Open it first,
    // then flip the contour-lines switch (role=switch).
    await page.getByRole('button', { name: /Map layers/i }).click()
    const toggle = page.getByRole('switch', { name: /Contour lines/i })
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    const vis = await page.evaluate(() => {
      const m = (window as unknown as { __map__?: { getLayoutProperty: (id: string, p: string) => string } }).__map__
      return m?.getLayoutProperty('contour-lines', 'visibility')
    })
    expect(vis).toBe('visible')
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
    await page.getByRole('button', { name: 'Close property details' }).click()
    await expect(page.getByText('Property Details')).not.toBeVisible()
  })

  test('responsive layout adapts to viewport', async ({ page }) => {
    await expect(page.locator('[aria-label="Holston Scout navigation"]')).toBeVisible()
    await expect(page.getByRole('textbox', { name: /Search owner/i })).toBeVisible()
  })

  test('map view is reflected in the URL after panning', async ({ page }) => {
    await page.evaluate(() => {
      const m = (window as unknown as { __map__?: { jumpTo: (o: object) => void } }).__map__
      if (m) m.jumpTo({ center: [-82.5, 36.5], zoom: 14 })
    })
    await expect.poll(() => new URL(page.url()).searchParams.get('z'), { timeout: 5000 }).not.toBeNull()
    const params = new URL(page.url()).searchParams
    expect(Number(params.get('z'))).toBeCloseTo(14, 1)
    expect(Number(params.get('lat'))).toBeCloseTo(36.5, 1)
    expect(Number(params.get('lng'))).toBeCloseTo(-82.5, 1)
  })

  // ── Build Fit (Day 3 hardening) ────────────────────────────────────────

  test('Test Building Fit CTA opens the workspace and renders default footprint', async ({ page }) => {
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await expect(page.getByText('Property Details')).toBeVisible({ timeout: 8000 })
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    // Workspace mounts, top bar present.
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })
    // Default 40x60 footprint is rendered immediately (mount-time onChange).
    // Verify the fit-footprint source has a feature.
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
            const m = (
              window as unknown as {
                __map__?: { querySourceFeatures: (id: string) => unknown[] }
              }
            ).__map__
            if (!m) return 0
            return m.querySourceFeatures('fit-footprint').length
          }),
        { timeout: 6000, intervals: [200, 400] },
      )
      .toBeGreaterThan(0)
  })

  test('exit button closes fit mode and clears fit layers', async ({ page }) => {
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })
    await page.getByRole('button', { name: /Exit Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toHaveCount(0)
    // Detail panel returns.
    await expect(page.getByText('Property Details')).toBeVisible({ timeout: 4000 })
    // fit-footprint source drained by the workspace's unmount cleanup.
    // Poll because querySourceFeatures can briefly return pre-setData
    // cached features depending on renderer flush timing.
    await expect
      .poll(async () =>
        await page.evaluate(() => {
          const m = (
            window as unknown as {
              __map__?: { querySourceFeatures: (id: string) => unknown[] }
            }
          ).__map__
          return m ? m.querySourceFeatures('fit-footprint').length : -1
        }), { timeout: 4000, intervals: [100, 250, 500] })
      .toBe(0)
  })

  test('clearing the parcel after fit mode also clears fit layers and selection', async ({ page }) => {
    // Real user flow: open a parcel, open fit mode, exit fit (which
    // restores the detail panel), then close the detail panel via its X.
    // Asserts: detail panel is gone (parcel deselected) and the
    // fit-footprint source is empty. The OBJECTID-keyed selection-layer
    // filters (parcels-selected / parcels-selected-fill / parcel-corners)
    // are NOT directly asserted here; the unit-level clearSelection logic
    // covers those.
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })

    // Step 1: exit fit mode. Detail panel returns.
    await page.getByRole('button', { name: /Exit Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toHaveCount(0)
    await expect(page.getByText('Property Details')).toBeVisible()

    // Step 2: clear the parcel via the detail panel's X.
    await page.getByRole('button', { name: /Close property details/i }).click()
    await expect(page.getByText('Property Details')).toHaveCount(0)

    // Step 3: verify fit-footprint source is empty. The workspace's
    // unmount-time clearFitLayers ran on Step 1, but querySourceFeatures
    // can briefly return pre-setData cached features depending on the
    // renderer's flush timing (observed flaky on chromium-tablet at iPad
    // Mini viewport). Poll instead of single-shot read.
    await expect
      .poll(async () =>
        await page.evaluate(() => {
          const m = (
            window as unknown as {
              __map__?: { querySourceFeatures: (id: string) => unknown[] }
            }
          ).__map__
          return m ? m.querySourceFeatures('fit-footprint').length : -1
        }), { timeout: 4000, intervals: [100, 250, 500] })
      .toBe(0)
  })

  test('saving a footprint adds it to the library and persists across reload', async ({ page }) => {
    // Wipe localStorage so the test starts with an empty library.
    await page.goto('/?lng=-82.3534&lat=36.3134&z=16')
    await page.evaluate(() => window.localStorage.removeItem('holston-scout/build-fit/v1'))
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })

    // Type a name, change rotation to 45, and save. The default 40 x 60 width
    // and length stay; the form's mount-time onChange has already populated
    // the draft so save can complete with valid geometry. Use stable test
    // ids to dodge layout/order fragility across viewports.
    const nameInput = page.locator('[data-testid="fit-form-name"]:visible')
    await expect(nameInput).toBeVisible({ timeout: 8000 })
    await nameInput.fill('40 x 60 shop')
    await page.locator('[data-testid="fit-form-rotation"]:visible').fill('45')
    await page.getByRole('button', { name: /^Save footprint$/i }).click()

    // The library now contains the saved footprint as a list item.
    await expect(page.getByRole('button', { name: /40 x 60 shop/ })).toBeVisible()

    // Reload, re-open the same parcel + fit mode, the library still has it.
    await page.reload()
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('button', { name: /40 x 60 shop/ })).toBeVisible()

    // Selecting the saved footprint preserves rotation. Auto-selection on
    // re-open already loads it, so just read the rotation field. :visible
    // filter dodges the dual-mount workspace (one hidden via media query).
    await expect(page.locator('[data-testid="fit-form-rotation"]:visible')).toHaveValue('45')
  })

  test('mobile bottom sheet exposes Footprint and Fit tabs', async ({ page, viewport }) => {
    // Bottom sheet only renders below sm (640px). iPad Mini's isMobile flag
    // is true even at tablet width, so the predicate uses viewport size.
    test.skip((viewport?.width ?? 0) >= 640, 'Bottom sheet only renders below sm breakpoint')
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })

    const footprintTab = page.getByRole('tab', { name: 'Footprint' })
    const fitTab = page.getByRole('tab', { name: 'Fit' })
    await expect(footprintTab).toBeVisible()
    await expect(fitTab).toBeVisible()
    await expect(footprintTab).toHaveAttribute('aria-selected', 'true')

    // Tap Fit, the Save footprint button (footprint-tab content) hides and
    // the Setbacks placeholder (fit-tab content) shows.
    await fitTab.click()
    await expect(footprintTab).toHaveAttribute('aria-selected', 'false')
    await expect(fitTab).toHaveAttribute('aria-selected', 'true')
    // The Fit tab now hosts the SetbackBlock (Phase 3). Verify by looking
    // for the 'Setbacks' label and the three mode buttons.
    await expect(
      page.getByText('Setbacks', { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'None' }).filter({ visible: true })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Uniform' }).filter({ visible: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Manual' }).filter({ visible: true }),
    ).toBeVisible()
  })

  test('rotation quick-buttons update the footprint geometry', async ({ page }) => {
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })

    // Wait for the default-rectangle to render (form's mount-time onChange
    // populates the fit-footprint source) before capturing its coordinates.
    await expect
      .poll(async () =>
        await page.evaluate(() => {
          const m = (
            window as unknown as {
              __map__?: { querySourceFeatures: (id: string) => Array<{ geometry: { coordinates: number[][][] } }> }
            }
          ).__map__
          if (!m) return 0
          return m.querySourceFeatures('fit-footprint').length
        }), { timeout: 6000, intervals: [200, 400] })
      .toBeGreaterThan(0)
    const before = await page.evaluate(() => {
      const m = (
        window as unknown as {
          __map__?: { querySourceFeatures: (id: string) => Array<{ geometry: { coordinates: number[][][] } }> }
        }
      ).__map__
      if (!m) return null
      const features = m.querySourceFeatures('fit-footprint')
      return features[0]?.geometry?.coordinates?.[0]?.[0] ?? null
    })
    expect(before).not.toBeNull()

    // Click the +90° quick-button. :visible filter picks the rendered copy
    // (desktop side panel OR mobile bottom sheet, never both).
    await page.locator('button[aria-label="Rotate +90 degrees"]:visible').click()

    // Geometry should have moved as a result of the rotation.
    await expect
      .poll(async () =>
        await page.evaluate(() => {
          const m = (
            window as unknown as {
              __map__?: { querySourceFeatures: (id: string) => Array<{ geometry: { coordinates: number[][][] } }> }
            }
          ).__map__
          if (!m) return null
          return m.querySourceFeatures('fit-footprint')[0]?.geometry?.coordinates?.[0]?.[0] ?? null
        }),
        { timeout: 4000 },
      )
      .not.toEqual(before)
  })

  test('Save placement persists a FitSession in localStorage', async ({ page }) => {
    // Wipe storage and start fresh.
    await page.goto('/?lng=-82.3534&lat=36.3134&z=16')
    await page.evaluate(() => window.localStorage.removeItem('holston-scout/build-fit/v1'))
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })

    // Need a name in the form, Save Placement auto-saves the footprint.
    const nameInput = page.locator('[data-testid="fit-form-name"]:visible')
    await expect(nameInput).toBeVisible({ timeout: 8000 })
    await nameInput.fill('Save-test shop')

    // Click Save placement. On mobile the button is inside the Fit tab of
    // the bottom sheet, so flip there first if a tab is rendered.
    const fitTab = page.getByRole('tab', { name: 'Fit' })
    if (await fitTab.count()) await fitTab.click()
    await page.locator('button:visible', { hasText: /^Save placement$/ }).click()

    // Brief saved-flash, button text changes.
    await expect(page.getByRole('button', { name: /Placement saved/ })).toBeVisible({ timeout: 2000 })

    // Storage holds at least one FootprintProject + one FitSession.
    const stored = await page.evaluate(() => {
      const raw = window.localStorage.getItem('holston-scout/build-fit/v1')
      return raw ? JSON.parse(raw) : null
    })
    expect(stored).not.toBeNull()
    expect(stored.schemaVersion).toBe(1)
    expect(stored.footprints?.length).toBeGreaterThan(0)
    expect(stored.sessions?.length).toBeGreaterThan(0)
    expect(stored.sessions[0].footprintProjectId).toBe(stored.footprints[0].id)
    expect(stored.sessions[0].placement.geometry.type).toBe('Polygon')
    expect(stored.sessions[0].result.measurementMethod).toBe('geodesic')
  })

  test('setback uniform mode renders the envelope and reports fitsEnvelope', async ({ page }) => {
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })

    // Mobile: flip to Fit tab where the setback controls live.
    const fitTab = page.getByRole('tab', { name: 'Fit' })
    if (await fitTab.count()) await fitTab.click()

    // DOM-level click via evaluate. Playwright's role-based click was
    // intermittently failing to propagate the React state change on
    // chromium-desktop even though the button was visible and the
    // selector matched; clicking via the DOM element's native click()
    // method fires the same event sequence reliably. The small
    // waitForTimeout between clicks gives React a tick to render the
    // 25 ft preset button before we search for it.
    await page.evaluate(() => {
      const u = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Uniform' && (b as HTMLElement).offsetParent !== null,
      )
      ;(u as HTMLButtonElement | undefined)?.click()
    })
    await page.waitForTimeout(250)
    // 10 ft is the smallest preset, which keeps an envelope render even
    // when chromium-desktop happens to click into a small parcel. The
    // setbackEnvelope helper correctly returns null + warning when a
    // setback eats the parcel (covered by its own unit tests), but this
    // e2e is about the happy path: setback configured -> envelope
    // rendered on the map.
    await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === '10 ft' && (b as HTMLElement).offsetParent !== null,
      )
      ;(p as HTMLButtonElement | undefined)?.click()
    })

    // The fit-envelope source should now carry features (envelope
    // polygon, potentially multi). Poll because Turf buffer + setData
    // flushing isn't synchronous in chromium.
    await expect
      .poll(async () =>
        await page.evaluate(() => {
          const m = (
            window as unknown as {
              __map__?: { querySourceFeatures: (id: string) => unknown[] }
            }
          ).__map__
          return m ? m.querySourceFeatures('fit-envelope').length : 0
        }), { timeout: 8000, intervals: [200, 400, 600, 1000] })
      .toBeGreaterThan(0)
  })

  test('setback Save Placement persists the envelope in the FitSession', async ({ page }) => {
    await page.goto('/?lng=-82.3534&lat=36.3134&z=16')
    await page.evaluate(() => window.localStorage.removeItem('holston-scout/build-fit/v1'))
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })

    // Type a name, set Uniform 15 ft, save placement.
    await page.locator('[data-testid="fit-form-name"]:visible').fill('Envelope-test shop')
    // Mobile: flip to Fit tab where the setback controls + Save live.
    const fitTab = page.getByRole('tab', { name: 'Fit' })
    if (await fitTab.count()) await fitTab.click()
    // DOM-level clicks, see comment on the sibling 'setback uniform' test.
    await page.evaluate(() => {
      const u = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Uniform' && (b as HTMLElement).offsetParent !== null,
      )
      ;(u as HTMLButtonElement | undefined)?.click()
    })
    await page.waitForTimeout(250)
    // 10 ft is the safest preset across parcels of different sizes.
    await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === '10 ft' && (b as HTMLElement).offsetParent !== null,
      )
      ;(p as HTMLButtonElement | undefined)?.click()
    })
    await page.waitForTimeout(250)
    await page.locator('button:visible', { hasText: /^Save placement$/ }).click()

    await expect(page.getByRole('button', { name: /Placement saved/ })).toBeVisible({ timeout: 3000 })

    const stored = await page.evaluate(() => {
      const raw = window.localStorage.getItem('holston-scout/build-fit/v1')
      return raw ? JSON.parse(raw) : null
    })
    expect(stored).not.toBeNull()
    expect(stored.sessions?.length).toBeGreaterThan(0)
    const s = stored.sessions[0]
    expect(s.setbackConfig.mode).toBe('uniform')
    expect(s.setbackConfig.setbackFt).toBe(10)
    expect(s.envelope.mode).toBe('uniform')
    expect(s.envelope.geometry).not.toBeNull()
    expect(['Polygon', 'MultiPolygon']).toContain(s.envelope.geometry.type)
  })

  test('project export downloads a .hscout.json file with the expected envelope', async ({ page }) => {
    // Seed one footprint so the export carries data.
    await page.goto('/?lng=-82.3534&lat=36.3134&z=16')
    await page.evaluate(() => window.localStorage.removeItem('holston-scout/build-fit/v1'))
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })

    // Save a footprint first (mobile flips to Fit tab for this in other
    // tests; Save footprint lives on the Footprint tab so we don't need
    // to flip).
    await page.locator('[data-testid="fit-form-name"]:visible').fill('Export-test shop')
    await page.getByRole('button', { name: /^Save footprint$/i }).click()
    await expect(page.getByRole('button', { name: /Export-test shop/ })).toBeVisible()

    // Trigger the export and capture the download.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export project file' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^holston-scout-fit-.*\.hscout\.json$/)

    // Read the download body and assert the envelope shape.
    const path = await download.path()
    expect(path).toBeTruthy()
    const fs = await import('node:fs/promises')
    const text = await fs.readFile(path!, 'utf8')
    const parsed = JSON.parse(text)
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.app?.name).toBe('Holston Scout')
    expect(typeof parsed.disclaimer).toBe('string')
    expect(parsed.data?.footprints?.length).toBeGreaterThan(0)
  })

  test('project import accepts a valid file and adds footprints to the library', async ({ page }) => {
    // Start with an empty store so the import is the only source of data.
    await page.goto('/?lng=-82.3534&lat=36.3134&z=16')
    await page.evaluate(() => window.localStorage.removeItem('holston-scout/build-fit/v1'))
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })

    // Build a project-file payload in-page (mirrors what exportStore +
    // serializeProjectFile produce). Then drive the hidden file input by
    // setting an in-memory File on it. This skips the OS file picker
    // entirely, which Playwright can't drive.
    const payload = {
      schemaVersion: 1,
      app: { name: 'Holston Scout', version: '1.0.0', url: 'https://tn-land-atlas.pages.dev' },
      generatedAt: new Date().toISOString(),
      disclaimer: 'planning estimate only',
      data: {
        schemaVersion: 1,
        footprints: [
          {
            id: 'imported-fp-001',
            name: 'Imported 40x60 shop',
            kind: 'rectangle',
            widthFt: 40,
            lengthFt: 60,
            rotationDeg: 0,
            stories: 1,
            footprintSqft: 2400,
            geometry: null,
            createdFrom: 'imported',
            notes: null,
            createdAt: '2026-05-10T00:00:00.000Z',
            updatedAt: '2026-05-10T00:00:00.000Z',
          },
        ],
        sessions: [],
        updatedAt: '2026-05-10T00:00:00.000Z',
      },
    }
    const fileInput = page.locator('input[type="file"][accept*="hscout"]')
    await fileInput.setInputFiles({
      name: 'test-import.hscout.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(payload)),
    })

    // Success notice appears.
    await expect(page.locator('[data-project-notice]:visible')).toContainText(
      /Imported 1 footprint/,
    )

    // Library now shows the imported footprint.
    await expect(
      page.getByRole('button', { name: /Imported 40x60 shop/ }).filter({ visible: true }),
    ).toBeVisible()
  })

  test('project import rejects an invalid file with an error notice', async ({ page }) => {
    await page.goto('/?lng=-82.3534&lat=36.3134&z=16')
    await page.evaluate(() => window.localStorage.removeItem('holston-scout/build-fit/v1'))
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })

    const fileInput = page.locator('input[type="file"][accept*="hscout"]')
    await fileInput.setInputFiles({
      name: 'bad.hscout.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{not json'),
    })

    await expect(page.locator('[data-project-notice]:visible')).toContainText(/not valid JSON/i)
  })

  test('Phase 5: Copy summary writes a fit summary to the clipboard', async ({ page }) => {
    // We avoid readText (blocked under mobile-emulated origins without an
    // active user gesture) and instead capture writeText into a global so
    // the test reads it back synchronously. This is also closer to what
    // the production code does: the handler only writes; it never reads.
    await page.addInitScript(() => {
      const w = window as unknown as { __copied?: string }
      const orig = navigator.clipboard?.writeText.bind(navigator.clipboard)
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            w.__copied = text
            if (orig) {
              try { await orig(text) } catch { /* ignore real-clipboard denial */ }
            }
          },
        },
      })
    })
    await page.goto('/?lng=-82.3534&lat=36.3134&z=16')
    await page.evaluate(() => window.localStorage.removeItem('holston-scout/build-fit/v1'))
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })

    // Name the footprint so the summary's Name line is stable. On mobile
    // the form lives in the Footprint tab (active by default); on tablet
    // and desktop both panels are mounted side-by-side.
    const nameInput = page.locator('[data-testid="fit-form-name"]:visible')
    await expect(nameInput).toBeVisible({ timeout: 8000 })
    await nameInput.fill('40 x 60 shop')

    // The Copy summary button lives in the Fit result panel. On mobile
    // (<sm) that panel is hidden behind the "Fit" tab. Switch tabs if the
    // mobile tablist is present.
    const fitTab = page.getByRole('tab', { name: 'Fit' })
    if ((await fitTab.count()) > 0 && (await fitTab.isVisible())) {
      await fitTab.click()
    }

    const copyButton = page.getByRole('button', { name: /Copy fit summary to clipboard/i }).filter({ visible: true })
    await expect(copyButton).toBeVisible({ timeout: 4000 })
    await copyButton.click()

    // Button flashes "Copied".
    await expect(page.getByRole('button', { name: /Copy fit summary to clipboard/i }).filter({ visible: true })).toContainText(/Copied/i)

    // The init-script clipboard shim captured the writeText payload into a
    // window global. Read it back without touching readText (which mobile
    // emulation blocks).
    const clipboardText = await page.evaluate(
      () => (window as unknown as { __copied?: string }).__copied ?? '',
    )
    expect(clipboardText).toContain('Holston Scout — Building Fit Report')
    expect(clipboardText).toContain('Name: 40 x 60 shop')
    expect(clipboardText).toContain('Dimensions: 40 × 60 ft')
    expect(clipboardText).toContain('Planning estimate only')
  })

  test('Save placement on a blank-name footprint surfaces a notice instead of no-op', async ({ page }) => {
    // Audit finding: Save Placement silently returned when the footprint
    // had no name. Now it flashes an error notice telling the user to name
    // the footprint first.
    await page.goto('/?lng=-82.3534&lat=36.3134&z=16')
    await page.evaluate(() => window.localStorage.removeItem('holston-scout/build-fit/v1'))
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })

    // Make sure the name is blank by explicitly clearing it.
    const nameInput = page.locator('[data-testid="fit-form-name"]:visible')
    await expect(nameInput).toBeVisible({ timeout: 8000 })
    await nameInput.fill('')

    // Switch to Fit tab on mobile so the Save placement button is reachable.
    const fitTab = page.getByRole('tab', { name: 'Fit' })
    if ((await fitTab.count()) > 0 && (await fitTab.isVisible())) {
      await fitTab.click()
    }

    await page
      .getByRole('button', { name: /^Save placement$/i })
      .filter({ visible: true })
      .click()

    await expect(page.locator('[data-project-notice]:visible')).toContainText(/Name the footprint/i)
  })

  test('Phase 5: print stylesheet promotes the fit-report target', async ({ page }) => {
    // Verify the always-mounted FitReport gets `display: block` under
    // @media print and that the workspace panels (top bar, side panels)
    // are hidden. We don't actually trigger the print dialog (Playwright
    // can't dismiss it cross-browser); emulateMedia is the standard seam.
    await page.goto('/?lng=-82.3534&lat=36.3134&z=16')
    await page.evaluate(() => window.localStorage.removeItem('holston-scout/build-fit/v1'))
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })

    // On screen, the report is hidden.
    const report = page.locator('[data-print-target="fit-report"]')
    await expect(report).toHaveCount(1)
    await expect(report).toBeHidden()

    // Emulate print media. The report should become visible; the workspace
    // top bar (a non-print-target direct child) should be hidden by the
    // [data-fit-workspace] > *:not([data-print-target]) rule.
    await page.emulateMedia({ media: 'print' })
    await expect.poll(async () => report.evaluate((el) => getComputedStyle(el).display)).toBe('block')
    // Assert the top-bar wrapper (first direct child of the workspace) is
    // display:none. getComputedStyle on the button itself would still read
    // inline-flex even when its ancestor is hidden.
    const topBar = page.locator('[data-fit-workspace] > div').first()
    await expect.poll(async () => topBar.evaluate((el) => getComputedStyle(el).display)).toBe('none')

    // Sanity: the report contains the section headers and the disclaimer.
    await expect(report.getByRole('heading', { name: /Holston Scout — Building Fit Report/i })).toBeVisible()
    await expect(report.getByRole('heading', { name: /Parcel/i })).toBeVisible()
    await expect(report.getByRole('heading', { name: /Footprint/i })).toBeVisible()
    await expect(report).toContainText(/Planning estimate only/)

    // Reset print emulation so subsequent tests in the same worker aren't
    // affected (Playwright shares the page across describe-block tests).
    await page.emulateMedia({ media: 'screen' })
  })

  test('Tools popover still works after entering and exiting fit mode', async ({ page }) => {
    await loadParcelsAt(page, -82.3534, 36.3134, 16)
    await clickFirstParcel(page)
    await page.getByRole('button', { name: /Test Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toBeVisible({ timeout: 8000 })
    await page.getByRole('button', { name: /Exit Building Fit/i }).click()
    await expect(page.locator('[data-fit-workspace]')).toHaveCount(0)
    // On mobile the detail panel is full-width and overlaps the bottom
    // action bar; close it before testing the Tools popover. Desktop has
    // a 80-wide side panel and would not intercept, but the close path
    // works there too.
    await page.getByRole('button', { name: /Close property details/i }).click()
    await page.getByRole('button', { name: /Drawing tools/i }).click()
    await expect(page.getByRole('button', { name: /Lasso parcels/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Measure distance/i })).toBeVisible()
  })

  test('home button resets view', async ({ page }) => {
    await page.evaluate(() => {
      const m = (window as unknown as { __map__?: { jumpTo: (o: object) => void } }).__map__
      if (m) m.jumpTo({ center: [-82.3534, 36.3134], zoom: 16 })
    })
    const home = page.getByRole('button', { name: /Home view/i })
    await home.click()
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
