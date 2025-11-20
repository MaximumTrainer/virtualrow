import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import HeartRateMonitor from '../components/HeartRateMonitor';
import { heartRateBluetoothService } from '../services/heartRateBluetoothService';

describe('HeartRateMonitor component', () => {
  beforeEach(() => {
    // clear any existing listeners and samples
    (heartRateBluetoothService as any).listeners = new Map();
    (heartRateBluetoothService as any).samples = [];
  });

  afterEach(() => {
    // ensure unmount clears listeners
    (heartRateBluetoothService as any).listeners = new Map();
    (heartRateBluetoothService as any).samples = [];
  });

  it('shows connection state on connected/disconnected events', async () => {
    render(<HeartRateMonitor />);

    // Initially disconnected
    expect(screen.getByText(/Disconnected/i)).toBeInTheDocument();

    // Emit connected
    act(() => (heartRateBluetoothService as any).emit('connected', {}));

    expect(await screen.findByText(/Connected/i)).toBeInTheDocument();
    const dot = document.querySelector('.hr-status-dot');
    expect(dot).toHaveClass('connected');

    // Emit disconnected
    act(() => (heartRateBluetoothService as any).emit('disconnected', {}));
    expect(await screen.findByText(/Disconnected/i)).toBeInTheDocument();
    expect(dot).toHaveClass('disconnected');
  });

  it('invokes onSample callback and updates metrics on heartRate event', async () => {
    const onSample = vi.fn();
    render(<HeartRateMonitor onSample={onSample} />);

    // Emit a heart rate sample
    act(() => (heartRateBluetoothService as any).emit('heartRate', { bpm: 84 }));

    expect(onSample).toHaveBeenCalled();
    expect(onSample.mock.calls[0][0]).toBe(84);

    // Check UI updated
    expect(await screen.findByText(/Current/)).toBeInTheDocument();
    expect(screen.getByText(/84 bpm/)).toBeInTheDocument();
  });
});
