import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { OutputView } from './components/OutputView'
import { StageView } from './components/StageView'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.hash === '#/output' ? <OutputView /> : window.location.hash === '#/stage' ? <StageView /> : <App />}
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
