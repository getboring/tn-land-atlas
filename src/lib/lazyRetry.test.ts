import { describe, it, expect, beforeEach, vi } from 'vitest'
import { lazyRetry } from './lazyRetry'

describe('lazyRetry', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('resolves with the import on success and clears the retry flag', async () => {
    const importer = vi.fn().mockResolvedValue({ default: 42 })
    const result = await lazyRetry(importer)
    expect(result).toEqual({ default: 42 })
    expect(importer).toHaveBeenCalledOnce()
    expect(window.sessionStorage.getItem('holston-scout-retry')).toBe('false')
  })

  it('reloads on first failure and sets the retry flag', async () => {
    const reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...original, reload },
    })
    const importer = vi.fn().mockRejectedValue(new Error('chunk load'))

    // Promise never resolves on the first attempt — it triggers reload instead.
    void lazyRetry(importer)
    await new Promise((r) => setTimeout(r, 5))

    expect(reload).toHaveBeenCalledOnce()
    expect(window.sessionStorage.getItem('holston-scout-retry')).toBe('true')

    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: original,
    })
  })

  it('rejects on second failure (retry flag already set)', async () => {
    window.sessionStorage.setItem('holston-scout-retry', 'true')
    const importer = vi.fn().mockRejectedValue(new Error('still broken'))
    await expect(lazyRetry(importer)).rejects.toThrow('still broken')
  })

  it('coerces non-Error rejections to Error', async () => {
    window.sessionStorage.setItem('holston-scout-retry', 'true')
    const importer = vi.fn().mockRejectedValue('string-shaped error')
    await expect(lazyRetry(importer)).rejects.toThrow('string-shaped error')
  })

  it('honors a custom retry key (multiple lazies on the same page)', async () => {
    window.sessionStorage.setItem('alt-key', 'true')
    const importer = vi.fn().mockRejectedValue(new Error('x'))
    await expect(lazyRetry(importer, 'alt-key')).rejects.toThrow('x')
    // Default key untouched
    expect(window.sessionStorage.getItem('holston-scout-retry')).toBeNull()
  })
})
