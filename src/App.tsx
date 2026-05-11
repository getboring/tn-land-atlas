// Top-level app shell.
//
// The tree, outside-in, is:
//
//   HolstonChrome           top bar (wordmark + brand mark, fills viewport)
//     ErrorBoundary         catches any render-time crash from the map subtree
//       Suspense            renders MapLoadingShell while ParcelMap is fetched
//         ParcelMap         the entire interactive surface
//
// ParcelMap is loaded via lazy() + lazyRetry() so the initial bundle stays
// small (the MapLibre + Terra Draw chunk only ships when the user lands on
// the map). lazyRetry adds a one-shot reload on chunk-load failure to
// recover from stale cached HTML pointing at a removed bundle.

import { lazy, Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { lazyRetry } from '@/lib/lazyRetry'
import { HolstonChrome } from '@/components/HolstonChrome'
import { MapLoadingShell } from '@/components/MapLoadingShell'
import { MapErrorFallback } from '@/components/MapErrorFallback'

const ParcelMap = lazy(() => lazyRetry(() => import('./components/ParcelMap')))

export default function App() {
  return (
    <HolstonChrome>
      <ErrorBoundary FallbackComponent={MapErrorFallback}>
        <Suspense fallback={<MapLoadingShell />}>
          <ParcelMap />
        </Suspense>
      </ErrorBoundary>
    </HolstonChrome>
  )
}
