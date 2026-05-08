import { lazy, Suspense } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'

// Defer MapLibre, Terra Draw, and maplibre-contour to a separate chunk so the
// initial HTML / CSS / shell paints fast on slow connections (rural TN, mobile).
const ParcelMap = lazy(() => import('./components/ParcelMap'))

function MapLoadingShell() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-brand-navy text-brand-stone">
      <div className="flex items-center gap-2 text-sm">
        <span className="inline-block w-2 h-2 rounded-full bg-brand-copper animate-pulse" aria-hidden />
        Loading map…
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<MapLoadingShell />}>
        <ParcelMap />
      </Suspense>
    </ErrorBoundary>
  )
}
