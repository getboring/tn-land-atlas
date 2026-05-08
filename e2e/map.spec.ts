import { test, expect } from '@playwright/test'

test.describe('TN Land Atlas', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for map canvas to appear
    await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 })
    // Wait for map to be interactive
    await page.waitForTimeout(1000)
  })

  test('map loads with title and controls', async ({ page }) => {
    await expect(page.getByText('TN Land Atlas')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-zoom-out')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-fullscreen')).toBeVisible()
    await expect(page.locator('.maplibregl-ctrl-geolocate')).toBeVisible()
  })

  test('county filter pills are visible and clickable', async ({ page }) => {
    const counties = ['All', 'Sullivan', 'Washington', 'Carter']
    for (const county of counties) {
      const btn = page.getByRole('button', { name: county, exact: false })
      await expect(btn).toBeVisible()
    }

    // Click Sullivan filter
    await page.getByRole('button', { name: 'Sullivan', exact: false }).click()
    await page.waitForTimeout(500)

    // Click back to All
    await page.getByRole('button', { name: 'All', exact: false }).first().click()
    await page.waitForTimeout(500)
  })

  test('search input exists and accepts text', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search owner or address…')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('123 main')
    await expect(searchInput).toHaveValue('123 main')
  })

  test('base layer toggle switches between Esri and NAIP', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /NAIP|Esri/i })
    await expect(toggle).toBeVisible()

    const initialText = await toggle.textContent()
    await toggle.click()
    await page.waitForTimeout(500)

    const newText = await toggle.textContent()
    expect(newText).not.toBe(initialText)
  })

  test('parcel visibility toggle works', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /Hide|Show/i })
    await expect(toggle).toBeVisible()

    await toggle.click()
    await page.waitForTimeout(500)
    await expect(page.getByRole('button', { name: 'Show', exact: false })).toBeVisible()

    await toggle.click()
    await page.waitForTimeout(500)
    await expect(page.getByRole('button', { name: 'Hide', exact: false })).toBeVisible()
  })

  test('zooming in loads parcel polygons', async ({ page }) => {
    // Pan to downtown Johnson City area and zoom in using map API
    await page.evaluate(() => {
      const map = (window as any).__map__
      if (map) {
        map.jumpTo({ center: [-82.3534, 36.3134], zoom: 15 })
      }
    })
    // Wait for moveend debounce + network
    await page.waitForTimeout(5000)

    // Parcel count indicator should appear
    await expect(page.getByText(/parcels visible/)).toBeVisible({ timeout: 15000 })
  })

  test.fixme('clicking a parcel opens detail sidebar', async ({ page }) => {
    // Pan to downtown Johnson City and zoom in
    await page.evaluate(() => {
      const map = (window as any).__map__
      if (map) {
        map.jumpTo({ center: [-82.3534, 36.3134], zoom: 16 })
      }
    })
    await page.waitForTimeout(4000)

    // Wait for parcels to load
    await expect(page.getByText(/parcels visible/)).toBeVisible({ timeout: 15000 })

    // Use page.mouse.click at viewport center (below top bar)
    const viewportSize = page.viewportSize()
    if (viewportSize) {
      const x = viewportSize.width / 2
      const y = viewportSize.height / 2 + 60
      await page.mouse.click(x, y)
      await page.waitForTimeout(2000)

      // If no parcel selected, try another spot
      const hasDetails = await page.getByText('Property Details').isVisible().catch(() => false)
      if (!hasDetails) {
        await page.mouse.click(x + 40, y)
        await page.waitForTimeout(2000)
      }

      // Detail sidebar should appear with Property Details
      await expect(page.getByText('Property Details')).toBeVisible({ timeout: 5000 })
    }
  })

  test.fixme('detail sidebar can be closed', async ({ page }) => {
    // Pan to downtown Johnson City and zoom in
    await page.evaluate(() => {
      const map = (window as any).__map__
      if (map) {
        map.jumpTo({ center: [-82.3534, 36.3134], zoom: 16 })
      }
    })
    await page.waitForTimeout(4000)

    await expect(page.getByText(/parcels visible/)).toBeVisible({ timeout: 15000 })

    const viewportSize = page.viewportSize()
    if (viewportSize) {
      const x = viewportSize.width / 2
      const y = viewportSize.height / 2 + 60
      await page.mouse.click(x, y)
      await page.waitForTimeout(2000)

      const hasDetails = await page.getByText('Property Details').isVisible().catch(() => false)
      if (!hasDetails) {
        await page.mouse.click(x + 40, y)
        await page.waitForTimeout(2000)
      }

      await expect(page.getByText('Property Details')).toBeVisible({ timeout: 5000 })

      // Close the sidebar using the X button
      await page.locator('button').filter({ has: page.locator('svg.lucide-x') }).click()
      await page.waitForTimeout(500)

      await expect(page.getByText('Property Details')).not.toBeVisible()
    }
  })

  test('responsive layout adapts to viewport', async ({ page }) => {
    // On mobile, the top bar should still be visible
    await expect(page.getByText('TN Land Atlas')).toBeVisible()

    // Search input should be visible
    await expect(page.getByPlaceholder('Search owner or address…')).toBeVisible()
  })
})
