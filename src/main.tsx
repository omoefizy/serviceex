import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { OutputView } from './components/OutputView'
import { RasterizeView } from './components/RasterizeView'
import { StageView } from './components/StageView'
import { StreamView } from './components/StreamView'
import { installFonts } from './lib/fonts'
import { setEntitlements } from '../shared/features'
import './index.css'

installFonts()

// The operator window learns what the plan allows before its first render. The output, stage and Stream windows never
// ask: a licence problem must never touch what the audience sees. If the answer cannot be had, every feature stays on.
if (!['#/output', '#/stage', '#/stream', '#/rasterize'].includes(window.location.hash)) setEntitlements(window.api.license.entitlements())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.hash === '#/output' ? (
      <OutputView />
    ) : window.location.hash === '#/stage' ? (
      <StageView />
    ) : window.location.hash === '#/stream' ? (
      <StreamView />
    ) : window.location.hash === '#/rasterize' ? (
      <RasterizeView />
    ) : (
      <App />
    )}
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
