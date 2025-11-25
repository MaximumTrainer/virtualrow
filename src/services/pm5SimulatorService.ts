import type { PM5Data } from '../types/index';

export interface SimulatorSettings {
  pace: number;        // seconds per 500m (e.g., 120 = 2:00/500m)
  cadence: number;     // strokes per minute
  heartRate: number;   // bpm
  power: number;       // watts
  isRowing: boolean;   // whether actively rowing
}

type SimulatorListener = (data: PM5Data) => void;

class PM5SimulatorService {
  private settings: SimulatorSettings = {
    pace: 120,         // 2:00/500m default
    cadence: 24,       // 24 strokes per minute
    heartRate: 130,    // 130 bpm
    power: 150,        // 150 watts
    isRowing: false,
  };

  private pm5Data: PM5Data = {
    pace: 0,
    distance: 0,
    elapsedTime: 0,
    power: 0,
    cadence: 0,
    heartRate: 0,
    calories: 0,
  };

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private listeners: SimulatorListener[] = [];
  private isActive: boolean = false;
  private startTime: number = 0;

  /**
   * Start the PM5 simulator
   */
  start(): void {
    if (this.isActive) return;
    
    this.isActive = true;
    this.startTime = Date.now();
    this.pm5Data = {
      pace: 0,
      distance: 0,
      elapsedTime: 0,
      power: 0,
      cadence: 0,
      heartRate: 0,
      calories: 0,
    };

    // Emit data at 4Hz (every 250ms) like real PM5
    this.intervalId = setInterval(() => this.tick(), 250);
    
    console.log('PM5 Simulator started');
  }

  /**
   * Stop the PM5 simulator
   */
  stop(): void {
    if (!this.isActive) return;
    
    this.isActive = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    console.log('PM5 Simulator stopped');
  }

  /**
   * Update simulator settings
   */
  updateSettings(newSettings: Partial<SimulatorSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
  }

  /**
   * Get current settings
   */
  getSettings(): SimulatorSettings {
    return { ...this.settings };
  }

  /**
   * Get current PM5 data
   */
  getData(): PM5Data {
    return { ...this.pm5Data };
  }

  /**
   * Check if simulator is running
   */
  isRunning(): boolean {
    return this.isActive;
  }

  /**
   * Add a data listener
   */
  addListener(listener: SimulatorListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove a data listener
   */
  removeListener(listener: SimulatorListener): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Internal tick - updates data and emits to listeners
   */
  private tick(): void {
    if (!this.isActive) return;

    const now = Date.now();
    const elapsedSeconds = (now - this.startTime) / 1000;

    if (this.settings.isRowing) {
      // Calculate speed: pace is seconds per 500m
      // Speed in m/s = 500 / pace
      const speedMps = this.settings.pace > 0 ? 500 / this.settings.pace : 0;
      
      // Add some natural variation to simulate real rowing
      const paceVariation = 1 + (Math.sin(elapsedSeconds * 0.5) * 0.02); // ±2% variation
      const cadenceVariation = 1 + (Math.sin(elapsedSeconds * 0.3) * 0.05); // ±5% variation
      const hrVariation = 1 + (Math.sin(elapsedSeconds * 0.1) * 0.02); // ±2% variation
      
      // Update PM5 data
      this.pm5Data.pace = Math.round(this.settings.pace * paceVariation * 100); // PM5 sends pace * 100
      this.pm5Data.cadence = Math.round(this.settings.cadence * cadenceVariation);
      this.pm5Data.heartRate = Math.round(this.settings.heartRate * hrVariation);
      this.pm5Data.power = Math.round(this.settings.power * paceVariation);
      this.pm5Data.elapsedTime = Math.round(elapsedSeconds);
      
      // Accumulate distance based on speed (0.25 seconds per tick)
      this.pm5Data.distance += speedMps * 0.25;
      
      // Calculate calories (rough estimate: ~1 calorie per 20 meters at moderate pace)
      this.pm5Data.calories = Math.round(this.pm5Data.distance / 20);
    } else {
      // Not rowing - show zero pace/cadence but keep time running
      this.pm5Data.pace = 0;
      this.pm5Data.cadence = 0;
      this.pm5Data.power = 0;
      this.pm5Data.elapsedTime = Math.round(elapsedSeconds);
      // Heart rate decreases slowly when not rowing
      const currentHR = this.pm5Data.heartRate ?? 80;
      this.pm5Data.heartRate = Math.max(60, currentHR - 0.1);
    }

    // Emit to all listeners
    this.listeners.forEach(listener => {
      try {
        listener({ ...this.pm5Data });
      } catch (e) {
        console.error('Error in PM5 simulator listener:', e);
      }
    });
  }

  /**
   * Reset the simulator data
   */
  reset(): void {
    this.startTime = Date.now();
    this.pm5Data = {
      pace: 0,
      distance: 0,
      elapsedTime: 0,
      power: 0,
      cadence: 0,
      heartRate: this.settings.heartRate,
      calories: 0,
    };
  }
}

// Export singleton instance
export const pm5Simulator = new PM5SimulatorService();
