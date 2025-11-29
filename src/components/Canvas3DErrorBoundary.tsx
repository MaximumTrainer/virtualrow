import React, { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  gpuAvailable: boolean;
  gpuBackend: 'webgpu' | 'webgl' | 'none';
}

/**
 * Check if WebGPU is available in the browser.
 */
async function checkWebGPUAvailability(): Promise<boolean> {
  try {
    if (!navigator.gpu) {
      return false;
    }
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

/**
 * Check if WebGL is available in the browser.
 */
function checkWebGLAvailability(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  } catch {
    return false;
  }
}

/**
 * Synchronously check GPU availability and return the best available backend.
 */
function checkGPUAvailabilitySync(): { available: boolean; backend: 'webgpu' | 'webgl' | 'none' } {
  // WebGL check is synchronous, WebGPU requires async check
  // For synchronous fallback, just check WebGL
  const webglAvailable = checkWebGLAvailability();
  if (webglAvailable) {
    return { available: true, backend: 'webgl' };
  }
  return { available: false, backend: 'none' };
}

/**
 * Error boundary for Three.js Canvas components.
 * Catches WebGPU/WebGL context loss and other 3D rendering errors,
 * displaying a graceful fallback UI instead of crashing the app.
 */
export class Canvas3DErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, gpuAvailable: true, gpuBackend: 'webgl' };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log error for debugging
    console.error('Canvas3D Error:', error);
    console.error('Error Info:', errorInfo);
    
    // Notify parent if callback provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Expose error flag for tests
    try {
      (window as unknown as Record<string, unknown>).__CANVAS3D_ERROR = true;
    } catch {
      // Ignore window access errors
    }
  }

  handleRetry = (): void => {
    // Check GPU availability before attempting retry
    // Try WebGPU first asynchronously, fall back to WebGL sync check
    checkWebGPUAvailability().then((webgpuAvailable) => {
      if (webgpuAvailable) {
        this.setState({ hasError: false, error: null, gpuAvailable: true, gpuBackend: 'webgpu' });
      } else {
        const { available, backend } = checkGPUAvailabilitySync();
        this.setState({ hasError: !available, error: null, gpuAvailable: available, gpuBackend: backend });
      }
    }).catch(() => {
      const { available, backend } = checkGPUAvailabilitySync();
      this.setState({ hasError: !available, error: null, gpuAvailable: available, gpuBackend: backend });
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Render fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback
      return (
        <div 
          className="canvas3d-error-fallback"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            minHeight: '200px',
            backgroundColor: '#1a1a2e',
            color: '#e0e0e0',
            borderRadius: '8px',
            padding: '20px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🚣</div>
          <h3 style={{ margin: '0 0 8px 0', color: '#ffffff' }}>
            3D View Unavailable
          </h3>
          <p style={{ margin: 0, fontSize: '14px', color: '#a0a0a0' }}>
            {this.state.gpuAvailable
              ? 'GPU context lost. Your workout data is still being tracked.'
              : 'WebGPU/WebGL is not available. Your workout data is still being tracked.'}
          </p>
          {this.state.gpuAvailable && (
            <button
              onClick={this.handleRetry}
              style={{
                marginTop: '16px',
                padding: '8px 16px',
                backgroundColor: '#4a9eda',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Retry 3D View
            </button>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default Canvas3DErrorBoundary;
