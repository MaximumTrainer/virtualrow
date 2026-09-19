import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ServicesProvider } from './context/ServicesContext.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { startTelemetry } from './utils/telemetryBoot.ts'

// Before anything renders, so an error during the first mount is recorded too.
startTelemetry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServicesProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ServicesProvider>
  </StrictMode>,
)
