import type { WorkoutSession, Split, PM5Data, HeartRateSample, WorkoutProgress } from '../types/index';

/** Maximum number of heart-rate samples retained per session (~10 minutes at 1 Hz). */
export const HR_SAMPLE_CAP = 600;
/** Minimum distance delta in meters between recorded splits. */
export const SPLIT_DISTANCE_METERS = 500;

export class WorkoutService {
  private sessions: WorkoutSession[] = [];
  private currentSession: WorkoutSession | null = null;
  /** Write-cursor for the heart-rate ring buffer once it has reached HR_SAMPLE_CAP. */
  private hrWriteCursor = 0;

  startSession(
    routeId: string,
    routeName: string,
    structuredWorkoutId?: string,
    rowerType?: 'pm5' | 'ftms',
    hrConnectedAtStart?: boolean,
    isGuest?: boolean,
  ): WorkoutSession {
    const session: WorkoutSession = {
      id: Date.now().toString(),
      routeId,
      routeName,
      startTime: new Date(),
      duration: 0,
      distance: 0,
      averagePace: 0,
      calories: 0,
      splits: [],
      isActive: true,
      heartRateSamples: [],
      structuredWorkoutId,
      rowerType,
      hrConnectedAtStart,
      isGuest,
    };

    this.currentSession = session;
    this.sessions.push(session);
    // Reset HR ring-buffer cursor for the new session. We only reset here (not in
    // endSession) because `updateSessionHeartRate` no-ops without a currentSession,
    // so the cursor's value between sessions is unobservable.
    this.hrWriteCursor = 0;
    try {
      if (typeof window !== 'undefined') {
        const event = new CustomEvent('virtualrow:sessionStarted', { detail: session });
        window.dispatchEvent(event);
      }
    } catch { /* ignore when not in browser */ }
    return session;
  }

  endSession(): WorkoutSession | null {
    if (!this.currentSession) return null;

    this.currentSession.isActive = false;
    this.currentSession.endTime = new Date();
    this.currentSession.duration =
      Math.floor(
        (this.currentSession.endTime.getTime() -
          this.currentSession.startTime.getTime()) /
          1000
      ) || 1;

    // Calculate average pace
    if (this.currentSession.splits.length > 0) {
      const totalPace = this.currentSession.splits.reduce(
        (sum, split) => sum + split.pace,
        0
      );
      this.currentSession.averagePace = Math.round(
        totalPace / this.currentSession.splits.length
      );
    }

    // Persist heart rate aggregate metrics
    if (this.currentSession.heartRateSamples && this.currentSession.heartRateSamples.length > 0) {
      const samples = this.currentSession.heartRateSamples;
      const avg = samples.reduce((s, v) => s + v.bpm, 0) / samples.length;
      const max = samples.reduce((m, v) => (v.bpm > m ? v.bpm : m), samples[0].bpm);
      this.currentSession.heartRateAvg = Math.round(avg);
      this.currentSession.heartRateMax = max;
    }

    const completedSession = this.currentSession;
    this.currentSession = null;
    try {
      if (typeof window !== 'undefined') {
        const event = new CustomEvent('virtualrow:sessionEnded', { detail: completedSession });
        window.dispatchEvent(event);
      }
    } catch { /* ignore when not in browser */ }
    return completedSession;
  }

  updateSessionWithPM5Data(data: PM5Data): void {
    if (!this.currentSession) return;

    this.currentSession.distance = data.distance;
    this.currentSession.duration = Math.floor(data.elapsedTime / 1000);
    this.currentSession.calories = data.calories || 0;

    if (data.heartRate) {
      this.updateSessionHeartRate(data.heartRate);
    }

    // Add split if distance increased
    const lastSplit = this.currentSession.splits[
      this.currentSession.splits.length - 1
    ];
    const lastDistance = lastSplit ? lastSplit.distance : 0;

    if (data.distance - lastDistance >= SPLIT_DISTANCE_METERS) {
      const split: Split = {
        distance: data.distance,
        time: Math.floor(data.elapsedTime / 1000),
        pace: data.pace || 0,
        power: data.power,
        heartRate: data.heartRate,
        timestamp: new Date(),
      };
      this.currentSession.splits.push(split);
    }
  }

  // Update workout progress for structured workouts
  updateWorkoutProgress(progress: WorkoutProgress): void {
    if (!this.currentSession) return;
    this.currentSession.workoutProgress = progress;
  }

  // Update heart rate stats independently (for external HR monitor or PM5 provided HR)
  updateSessionHeartRate(bpm: number) {
    if (!this.currentSession) return;
    if (!this.currentSession.heartRateSamples) {
      this.currentSession.heartRateSamples = [];
    }
    // Maintain only last HR_SAMPLE_CAP samples (~10 minutes at 1s interval) to limit memory.
    // Uses a dedicated write-cursor (NOT samples.length % CAP, which collapses to slot 0
    // once length === CAP) so the ring buffer wraps correctly.
    const sample: HeartRateSample = { bpm, timestamp: new Date() };
    const samples = this.currentSession.heartRateSamples;
    if (samples.length < HR_SAMPLE_CAP) {
      samples.push(sample);
    } else {
      samples[this.hrWriteCursor] = sample;
      this.hrWriteCursor = (this.hrWriteCursor + 1) % HR_SAMPLE_CAP;
    }
  }

  getCurrentSession(): WorkoutSession | null {
    return this.currentSession;
  }

  getSessionById(id: string): WorkoutSession | undefined {
    return this.sessions.find((session) => session.id === id);
  }

  getAllSessions(): WorkoutSession[] {
    return this.sessions.filter(s => !s.isGuest);
  }

  getSessionsByRoute(routeId: string): WorkoutSession[] {
    return this.sessions.filter((session) => session.routeId === routeId);
  }

  getRecentSessions(days: number = 30): WorkoutSession[] {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return this.sessions.filter((session) => session.startTime >= cutoffDate);
  }

  getStats() {
    const completedSessions = this.sessions.filter((s) => !s.isActive && !s.isGuest);

    return {
      totalWorkouts: completedSessions.length,
      totalDistance: completedSessions.reduce((sum, s) => sum + s.distance, 0),
      totalTime: completedSessions.reduce((sum, s) => sum + s.duration, 0),
      totalCalories: completedSessions.reduce((sum, s) => sum + s.calories, 0),
      averagePace:
        completedSessions.length > 0
          ? Math.round(
              completedSessions.reduce((sum, s) => sum + s.averagePace, 0) /
                completedSessions.length
            )
          : 0,
      bestPace:
        completedSessions.length > 0
          ? Math.min(...completedSessions.map((s) => s.averagePace))
          : 0,
    };
  }

  deleteSession(id: string): boolean {
    const index = this.sessions.findIndex((s) => s.id === id);
    if (index > -1) {
      this.sessions.splice(index, 1);
      return true;
    }
    return false;
  }

  exportSessionsAsJSON(): string {
    return JSON.stringify(this.sessions, null, 2);
  }

  exportSessionsAsCSV(): string {
    if (this.sessions.length === 0) return '';

    const headers = [
      'Date',
      'Route',
      'Distance (m)',
      'Duration (s)',
      'Pace (s/500m)',
      'Calories',
      'Avg HR',
      'Max HR',
    ];

    const rows = this.sessions
      .filter((s) => !s.isActive && !s.isGuest)
      .map((s) => [
        s.startTime.toISOString().split('T')[0],
        s.routeName,
        s.distance,
        s.duration,
        s.averagePace,
        s.calories,
        s.heartRateAvg ?? this.computeAverageHR(s) ?? '',
        s.heartRateMax ?? this.computeMaxHR(s) ?? '',
      ]);

    return [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
    ].join('\n');
  }

  private computeAverageHR(session: WorkoutSession): number | undefined {
    const samples = session.heartRateSamples || [];
    if (samples.length === 0) return undefined;
    const avg = samples.reduce((sum, s) => sum + s.bpm, 0) / samples.length;
    return Math.round(avg);
  }

  private computeMaxHR(session: WorkoutSession): number | undefined {
    const samples = session.heartRateSamples || [];
    if (samples.length === 0) return undefined;
    return samples.reduce((m, s) => (s.bpm > m ? s.bpm : m), samples[0].bpm);
  }
}

export const workoutService = new WorkoutService();

// Expose for test harness and runtime inspection in Playwright/tests
try {
  if (typeof window !== 'undefined' && window.__PLAYWRIGHT_TESTING) {
    window.__workoutService = workoutService;
  }
} catch {
  /* ignore when running in Node */
}
