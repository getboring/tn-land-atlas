# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: debug-map.spec.ts >> debug map api
- Location: e2e/debug-map.spec.ts:3:1

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
  3  | test('debug map api', async ({ page }) => {
  4  |   await page.goto('/')
> 5  |   await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 })
     |              ^ TimeoutError: page.waitForSelector: Timeout 15000ms exceeded.
  6  |   
  7  |   // Wait for map to be exposed
  8  |   await page.waitForFunction(() => !!(window as any).__map__, {}, { timeout: 10000 })
  9  |   
  10 |   const zoom = await page.evaluate(() => {
  11 |     const map = (window as any).__map__
  12 |     return map ? map.getZoom() : null
  13 |   })
  14 |   console.log('Initial zoom:', zoom)
  15 |   
  16 |   await page.evaluate(() => {
  17 |     const map = (window as any).__map__
  18 |     if (map) map.setZoom(15)
  19 |   })
  20 |   
  21 |   await page.waitForTimeout(2000)
  22 |   
  23 |   const newZoom = await page.evaluate(() => {
  24 |     const map = (window as any).__map__
  25 |     return map ? map.getZoom() : null
  26 |   })
  27 |   console.log('New zoom:', newZoom)
  28 |   
  29 |   expect(newZoom).toBe(15)
  30 | })
  31 | 
```