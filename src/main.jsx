import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Gate from './components/Gate.jsx'
import { STATIC } from './services/api'

// On GitHub Pages the app opens only after the password unlocks the data.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    {STATIC ? <Gate><App /></Gate> : <App />}
  </StrictMode>,
)
