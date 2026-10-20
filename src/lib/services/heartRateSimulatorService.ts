import { heartRateBluetoothService } from './heartRateBluetoothService';

class HeartRateSimulatorService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _bpm = 130;
  private _isActive = false;
  private elapsed = 0;

  start(bpm = 130): void {
    if (this._isActive) return;
    this._bpm = bpm;
    this.elapsed = 0;
    this._isActive = true;
    heartRateBluetoothService.simulateConnected('HR Simulator');
    this.intervalId = setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    if (!this._isActive) return;
    this._isActive = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    heartRateBluetoothService.simulateDisconnected();
  }

  setBpm(bpm: number): void {
    this._bpm = Math.max(40, Math.min(220, bpm));
  }

  getBpm(): number {
    return this._bpm;
  }

  isRunning(): boolean {
    return this._isActive;
  }

  private tick(): void {
    this.elapsed++;
    // Gentle sinusoidal variation to mimic natural HR fluctuation (±3 bpm)
    const variation = Math.sin(this.elapsed * 0.15) * 2 + Math.sin(this.elapsed * 0.37) * 1.5;
    const bpm = Math.round(this._bpm + variation);
    heartRateBluetoothService.simulateSample(bpm);
  }
}

export const heartRateSimulator = new HeartRateSimulatorService();
