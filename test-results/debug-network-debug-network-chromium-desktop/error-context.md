# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: debug-network.spec.ts >> debug network
- Location: e2e/debug-network.spec.ts:3:1

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
  3  | test('debug network', async ({ page }) => {
  4  |   // Listen to all network requests
  5  |   const requests: string[] = []
  6  |   page.on('request', req => {
  7  |     if (req.url().includes('johnsoncitytn.org') || req.url().includes('api/parcels')) {
  8  |       requests.push(req.url())
  9  |     }
  10 |   })
  11 |   
  12 |   const responses: {url: string, status: number}[] = []
  13 |   page.on('response', res => {
  14 |     if (res.url().includes('johnsoncitytn.org') || res.url().includes('api/parcels')) {
  15 |       responses.push({url: res.url(), status: res.status()})
  16 |     }
  17 |   })
  18 |   
  19 |   await page.goto('/')
> 20 |   await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 })
     |              ^ TimeoutError: page.waitForSelector: Timeout 15000ms exceeded.
  21 |   await page.waitForFunction(() => !!(window as any).__map__, {}, { timeout: 10000 })
  22 |   
  23 |   await page.evaluate(() => {
  24 |     const map = (window as any).__map__
  25 |     if (map) {
  26 |       map.jumpTo({ center: [-82.3534, 36.3134], zoom: 15 })
  27 |     }
  28 |   })
  29 |   
  30 |   await page.waitForTimeout(5000)
  31 |   
  32 |   console.log('Requests:', requests)
  33 |   console.log('Responses:', responses)
  34 | })
  35 | 
```