import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './styles.css'

document.documentElement.dataset.platform = navigator.userAgent.includes('Macintosh') ? 'darwin' : 'win32'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
