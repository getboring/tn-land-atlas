# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map.spec.ts >> TN Land Atlas >> parcel visibility toggle works
- Location: e2e/map.spec.ts:55:3

# Error details

```
TimeoutError: page.waitForSelector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('.maplibregl-canvas') to be visible

```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test'
  2   | 
  3   | test.describe('TN Land Atlas', () => {
  4   |   test.beforeEach(async ({ page }) => {
  5   |     await page.goto('/')
  6   |     // Wait for map canvas to appear
> 7   |     await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 })
      |                ^ TimeoutError: page.waitForSelector: Timeout 15000ms exceeded.
  8   |     // Wait for map to be interactive
  9   |     await page.waitForTimeout(1000)
  10  |   })
  11  | 
  12  |   test('map loads with title and controls', async ({ page }) => {
  13  |     await expect(page.getByText('TN Land Atlas')).toBeVisible()
  14  |     await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
  15  |     await expect(page.locator('.maplibregl-ctrl-zoom-out')).toBeVisible()
  16  |     await expect(page.locator('.maplibregl-ctrl-fullscreen')).toBeVisible()
  17  |     await expect(page.locator('.maplibregl-ctrl-geolocate')).toBeVisible()
  18  |   })
  19  | 
  20  |   test('county filter pills are visible and clickable', async ({ page }) => {
  21  |     const counties = ['All', 'Sullivan', 'Washington', 'Carter']
  22  |     for (const county of counties) {
  23  |       const btn = page.getByRole('button', { name: county, exact: false })
  24  |       await expect(btn).toBeVisible()
  25  |     }
  26  | 
  27  |     // Click Sullivan filter
  28  |     await page.getByRole('button', { name: 'Sullivan', exact: false }).click()
  29  |     await page.waitForTimeout(500)
  30  | 
  31  |     // Click back to All
  32  |     await page.getByRole('button', { name: 'All', exact: false }).first().click()
  33  |     await page.waitForTimeout(500)
  34  |   })
  35  | 
  36  |   test('search input exists and accepts text', async ({ page }) => {
  37  |     const searchInput = page.getByPlaceholder('Search owner or address…')
  38  |     await expect(searchInput).toBeVisible()
  39  |     await searchInput.fill('123 main')
  40  |     await expect(searchInput).toHaveValue('123 main')
  41  |   })
  42  | 
  43  |   test('base layer toggle switches between Esri and NAIP', async ({ page }) => {
  44  |     const toggle = page.getByRole('button', { name: /NAIP|Esri/i })
  45  |     await expect(toggle).toBeVisible()
  46  | 
  47  |     const initialText = await toggle.textContent()
  48  |     await toggle.click()
  49  |     await page.waitForTimeout(500)
  50  | 
  51  |     const newText = await toggle.textContent()
  52  |     expect(newText).not.toBe(initialText)
  53  |   })
  54  | 
  55  |   test('parcel visibility toggle works', async ({ page }) => {
  56  |     const toggle = page.getByRole('button', { name: /Hide|Show/i })
  57  |     await expect(toggle).toBeVisible()
  58  | 
  59  |     await toggle.click()
  60  |     await page.waitForTimeout(500)
  61  |     await expect(page.getByRole('button', { name: 'Show', exact: false })).toBeVisible()
  62  | 
  63  |     await toggle.click()
  64  |     await page.waitForTimeout(500)
  65  |     await expect(page.getByRole('button', { name: 'Hide', exact: false })).toBeVisible()
  66  |   })
  67  | 
  68  |   test('zooming in loads parcel polygons', async ({ page }) => {
  69  |     // Pan to downtown Johnson City area and zoom in using map API
  70  |     await page.evaluate(() => {
  71  |       const map = (window as any).__map__
  72  |       if (map) {
  73  |         map.flyTo({ center: [-82.3534, 36.3134], zoom: 15 })
  74  |       }
  75  |     })
  76  |     await page.waitForTimeout(4000)
  77  | 
  78  |     // Parcel count indicator should appear
  79  |     await expect(page.getByText(/parcels visible/)).toBeVisible({ timeout: 15000 })
  80  |   })
  81  | 
  82  |   test('clicking a parcel opens detail sidebar', async ({ page }) => {
  83  |     // Pan to downtown Johnson City and zoom in
  84  |     await page.evaluate(() => {
  85  |       const map = (window as any).__map__
  86  |       if (map) {
  87  |         map.flyTo({ center: [-82.3534, 36.3134], zoom: 15 })
  88  |       }
  89  |     })
  90  |     await page.waitForTimeout(4000)
  91  | 
  92  |     // Wait for parcels to load
  93  |     await expect(page.getByText(/parcels visible/)).toBeVisible({ timeout: 15000 })
  94  | 
  95  |     // Click on canvas center (below top bar)
  96  |     const canvas = page.locator('.maplibregl-canvas')
  97  |     const box = await canvas.boundingBox()
  98  |     if (box) {
  99  |       await canvas.click({ position: { x: box.width / 2, y: box.height / 2 + 60 }, force: true })
  100 |       await page.waitForTimeout(1500)
  101 | 
  102 |       // Detail sidebar should appear with Property Details
  103 |       await expect(page.getByText('Property Details')).toBeVisible({ timeout: 5000 })
  104 |     }
  105 |   })
  106 | 
  107 |   test('detail sidebar can be closed', async ({ page }) => {
```