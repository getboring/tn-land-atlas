# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: debug-parcel.spec.ts >> debug parcel loading
- Location: e2e/debug-parcel.spec.ts:3:1

# Error details

```
TimeoutError: page.waitForSelector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('.maplibregl-canvas') to be visible

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | test('debug parcel loading', async ({ page }) => {
  4  |   await page.goto('/')
> 5  |   await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 })
     |              ^ TimeoutError: page.waitForSelector: Timeout 15000ms exceeded.
  6  |   await page.waitForFunction(() => !!(window as any).__map__, {}, { timeout: 10000 })
  7  |   
  8  |   // Use jumpTo for instant center change
  9  |   await page.evaluate(() => {
  10 |     const map = (window as any).__map__
  11 |     if (map) {
  12 |       map.jumpTo({ center: [-82.3534, 36.3134], zoom: 15 })
  13 |     }
  14 |   })
  15 |   
  16 |   // Wait for moveend to fire and parcels to load
  17 |   await page.waitForTimeout(5000)
  18 |   
  19 |   // Check if parcel count is shown
  20 |   const hasParcelCount = await page.getByText(/parcels visible/).isVisible().catch(() => false)
  21 |   console.log('Has parcel count:', hasParcelCount)
  22 |   
  23 |   // Check if features were loaded
  24 |   const featureCount = await page.evaluate(() => {
  25 |     const map = (window as any).__map__
  26 |     if (!map) return -1
  27 |     const source = map.getSource('parcels')
  28 |     return source?._data?.features?.length || 0
  29 |   })
  30 |   console.log('Feature count:', featureCount)
  31 | })
  32 | 
```