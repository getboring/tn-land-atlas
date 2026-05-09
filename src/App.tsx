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
