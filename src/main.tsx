import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { OutputView } from './components/OutputView'
import { RasterizeView } from './components/RasterizeView'
import { StageView } from './components/StageView'
import { StreamView } from './components/StreamView'
import './index.css'

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
