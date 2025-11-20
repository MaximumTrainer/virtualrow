import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Lightweight Leaflet stub for component tests to avoid real map initialization overhead.
vi.mock('leaflet', () => {
  const noop = () => {};
  const layerStub = () => {
    const obj = {
      on: noop,
      off: noop,
      setUrl: noop,
      redraw: noop,
      setZIndex: noop,
      getTileUrl: () => 'https://a.tile.openstreetmap.org/0/0/0.png',
      addTo: () => obj,
    };
    return obj;
  };
  const L = {
    map: () => ({
      whenReady: (cb: any) => cb(),
      invalidateSize: noop,
      remove: noop,
      on: noop,
      off: noop,
      fitBounds: noop,
    }),
    tileLayer: layerStub,
    polyline: () => ({ addTo: () => ({}) }),
    marker: () => ({ bindPopup: () => ({ addTo: () => ({}) }) }),
    icon: () => ({}),
    latLngBounds: () => ({}),
    Icon: { Default: function() {} },
  } as any;
  return { default: L, ...L };
});

// Polyfill minimal ResizeObserver & IntersectionObserver for tests
class MockResizeObserver {
  callback: any;
  constructor(cb: any) { this.callback = cb; }
  observe() {}
  disconnect() {}
}
class MockIntersectionObserver {
  callback: any;
  constructor(cb: any) { this.callback = cb; }
  observe() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = MockResizeObserver;
(globalThis as any).IntersectionObserver = MockIntersectionObserver;
