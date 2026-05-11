// Vite client entry. Mounts the React tree into `#root` inside
// `index.html`. StrictMode is always on; double-render warnings here
// surface unsafe effect dependencies before they hit production.
//
// The non-null assertion on `getElementById('root')` is the standard
// Vite pattern — the element is guaranteed by `index.html`. If a future
// HTML refactor moves the mount point, that assertion will throw at
// boot, which is the failure mode we want.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('main.tsx: #root element missing from index.html')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
