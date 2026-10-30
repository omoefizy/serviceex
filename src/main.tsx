import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { OutputView } from './components/OutputView'
import { RasterizeView } from './components/RasterizeView'
import { StageView } from './components/StageView'
import { StreamKeyView, StreamView } from './components/StreamView'
import { installFonts } from './lib/fonts'
import { setEntitlements } from '../shared/features'
// The UI fonts are bundled, not linked, so the app looks the same offline.
import '@fontsource/figtree/400.css'
import '@fontsource/figtree/500.css'
import '@fontsource/figtree/600.css'
import '@fontsource/figtree/700.css'
import '@fontsource/bricolage-grotesque/600.css'
import '@fontsource/bricolage-grotesque/700.css'
import './index.css'

installFonts()

// Dev only: every shared component and state at #/ui-kit. Production builds drop it, and its import, entirely.
const UiKit = import.meta.env.DEV ? lazy(() => import('./dev/UiKit')) : null
const isUiKit = UiKit !== null && window.location.hash === '#/ui-kit'
// Dev only: every light effect on air, for scripts/fx-bench.ts.
const FxBench = import.meta.env.DEV ? lazy(() => import('./dev/FxBench')) : null
const isFxBench = FxBench !== null && window.location.hash.startsWith('#/fx-bench')

// The operator window learns what the plan allows before its first render. The output, stage and Stream windows never
// ask: a licence problem must never touch what the audience sees. If the answer cannot be had, every feature stays on.
if (!isUiKit && !isFxBench && !['#/output', '#/stage', '#/stream', '#/stream-key', '#/rasterize'].includes(window.location.hash)) setEntitlements(window.api.license.entitlements())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isUiKit && UiKit ? (
      <Suspense fallback={null}>
        <UiKit />
      </Suspense>
    ) : isFxBench && FxBench ? (
      <Suspense fallback={null}>
        <FxBench />
      </Suspense>
    ) : window.location.hash === '#/output' ? (
      <OutputView />
    ) : window.location.hash === '#/stage' ? (
      <StageView />
    ) : window.location.hash === '#/stream' ? (
      <StreamView />
    ) : window.location.hash === '#/stream-key' ? (
      <StreamKeyView />
    ) : window.location.hash === '#/rasterize' ? (
      <RasterizeView />
    ) : (
      <App />
    )}
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer?.on('main-process-message', (_event, message) => {
  console.log(message)
})
