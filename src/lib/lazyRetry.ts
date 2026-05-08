/**
 * Wraps a dynamic import with a one-shot page reload on failure.
 * Prevents infinite reload loops via sessionStorage flag.
 * Solves ChunkLoadError after deploys when user has stale chunk hashes.
 */
export function lazyRetry<T>(
  importer: () => Promise<T>,
  key = 'holston-scout-retry',
): Promise<T> {
  return new Promise((resolve, reject) => {
    const refreshed = JSON.parse(
      window.sessionStorage.getItem(key) || 'false',
    ) as boolean
    importer()
      .then((mod) => {
        window.sessionStorage.setItem(key, 'false')
        resolve(mod)
      })
      .catch((err: unknown) => {
        if (!refreshed) {
          window.sessionStorage.setItem(key, 'true')
          window.location.reload()
          return
        }
        reject(err instanceof Error ? err : new Error(String(err)))
      })
  })
}
