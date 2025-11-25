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
    const statusElement = document.querySelector('.device-status');
    expect(statusElement).toHaveClass('connected');

    // Emit disconnected
    act(() => (heartRateBluetoothService as any).emit('disconnected', {}));
    expect(await screen.findByText(/Disconnected/i)).toBeInTheDocument();
    expect(statusElement).toHaveClass('disconnected');
  });

  it('invokes onSample callback and updates metrics on heartRate event', async () => {
    const onSample = vi.fn();
    render(<HeartRateMonitor onSample={onSample} />);

    // Emit a heart rate sample
    act(() => (heartRateBluetoothService as any).emit('heartRate', { bpm: 84 }));

    expect(onSample).toHaveBeenCalled();
    expect(onSample.mock.calls[0][0]).toBe(84);

    // Check UI updated - value and unit are now in separate divs
    expect(await screen.findByText(/Current/)).toBeInTheDocument();
    expect(screen.getByText('84')).toBeInTheDocument();
    const metricUnits = screen.getAllByText('bpm');
    expect(metricUnits.length).toBeGreaterThan(0);
  });
});
