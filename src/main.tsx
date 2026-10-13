import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ServicesProvider } from './context/ServicesContext.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { startTelemetry } from './utils/telemetryBoot.ts'
import { checkBootCrash, reportFromErrorBoundary } from './utils/crashBoot.ts'
import { crashReporterService } from './services/crashReporterService.ts'

// Before anything renders, so an error during the first mount is recorded too.
startTelemetry()

const BUILD_SHA = (import.meta.env?.VITE_BUILD_SHA as string | undefined) ?? 'dev'

// If the previous run died without saying goodbye, report it once (#473 FR1).
// Deferred to idle inside, so first paint is never blocked.
checkBootCrash(crashReporterService, { buildSha: BUILD_SHA })

// #473 AC2 test seam: the e2e spec forces an error-boundary trip by calling
// this hook. The production boundaries do exactly the same call from their
// own `componentDidCatch`. Setting this on `window` under
// `__PLAYWRIGHT_TESTING` keeps it off every real session.
if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__PLAYWRIGHT_TESTING) {
  ;(window as unknown as Record<string, unknown>).__VIRTUALROW_SIMULATE_BOUNDARY__ = (
    message: string,
  ): void => {
    reportFromErrorBoundary(
      crashReporterService,
      new Error(message),
      { componentStack: '  at AlwaysThrows\n  at SceneErrorBoundary' },
      { boundary: 'Canvas3D', buildSha: BUILD_SHA },
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServicesProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ServicesProvider>
  </StrictMode>,
)
