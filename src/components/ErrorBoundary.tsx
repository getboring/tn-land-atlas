import { Component, type ErrorInfo, type ReactNode } from 'react'

// React ErrorBoundary — when the map or any child throws during render or in
// a lifecycle method, the boundary catches it and shows a recovery UI instead
// of a blank white screen. Errors are logged so they show up in browser
// devtools and (when configured) in any error-reporting integration.

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[error-boundary]', error, info)
  }

  reload = () => {
    window.location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="h-full w-full flex items-center justify-center bg-brand-navy text-brand-parchment p-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-lg font-semibold">Something broke.</h1>
          <p className="text-sm text-brand-stone">
            The map component crashed. The page log has the details. Reloading
            usually clears the state that caused it.
          </p>
          <pre className="text-[10px] text-brand-stone bg-black/30 p-2 rounded text-left max-h-32 overflow-auto">
            {String(error.message ?? error)}
          </pre>
          <button
            type="button"
            onClick={this.reload}
            className="inline-flex items-center justify-center h-10 px-4 rounded-lg bg-brand-copper text-white text-sm font-medium hover:bg-brand-copper/90"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
