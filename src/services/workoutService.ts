import type {
  Coordinate,
  HeartRateSample,
  PM5Data,
  Split,
  WorkoutProgress,
  WorkoutSession,
} from '../types/index';
import { ActivitySampler } from './activitySampler';

/** Minimum distance delta in meters between recorded splits. */
export const SPLIT_DISTANCE_METERS = 500;

export class WorkoutService {
  private sessions: WorkoutSession[] = [];
  private currentSession: WorkoutSession | null = null;
  private pm5DistanceOffsetMeters: number | null = null;
  private isPaused = false;
  private sampler = new ActivitySampler();

  /**
   * @param routeCoordinates the selected route's polyline, so the 1 Hz activity
   *   stream can place each sample on the water actually rowed (issue #221, R1).
   *   Omitted for sessions with no route geometry — those samples carry no position.
   */
  startSession(
    routeId: string,
    routeName: string,
    structuredWorkoutId?: string,
    rowerType?: 'pm5' | 'ftms',
    hrConnectedAtStart?: boolean,
    isGuest?: boolean,
    routeCoordinates?: Coordinate[],
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
      samples: [],
      structuredWorkoutId,
      rowerType,
      hrConnectedAtStart,
      isGuest,
    };

    this.currentSession = session;
    this.pm5DistanceOffsetMeters = null;
    this.isPaused = false;
    this.sampler.start(routeCoordinates);
    session.samples = this.sampler.getSamples();
    this.sessions.push(session);
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
    this.pm5DistanceOffsetMeters = null;
    this.isPaused = false;
    try {
      if (typeof window !== 'undefined') {
        const event = new CustomEvent('virtualrow:sessionEnded', { detail: completedSession });
        window.dispatchEvent(event);
      }
    } catch { /* ignore when not in browser */ }
    return completedSession;
  }

  pauseSession(): void {
    this.isPaused = true;
  }

  resumeSession(): void {
    this.isPaused = false;
  }

  updateSessionWithPM5Data(data: PM5Data): void {
    if (!this.currentSession) return;

    if (data.heartRate) {
      this.updateSessionHeartRate(data.heartRate);
    }

    if (this.isPaused) return;

    if (this.pm5DistanceOffsetMeters === null) {
      this.pm5DistanceOffsetMeters = data.distance;
    }

    // `PM5Data.elapsedTime` is seconds: pm5-base.js scales the 24-bit
    // centisecond field by 0.01, and FTMS reports whole seconds. Dividing by
    // 1000 here left `duration` and every `Split.time` at zero for any row
    // shorter than ~17 minutes, and pinned the activity stream to t=0.
    const elapsedSeconds = Math.floor(data.elapsedTime);
    const adjustedDistance = Math.max(0, data.distance - this.pm5DistanceOffsetMeters);

    // Ensure distance never regresses due to transient stale/zero/backwards packets.
    this.currentSession.distance = Math.max(this.currentSession.distance, adjustedDistance);
    this.currentSession.duration = elapsedSeconds;
    this.currentSession.calories = data.calories || 0;

    this.sampler.record(data, elapsedSeconds, this.currentSession.distance);

    // Add splits at each 500m boundary crossed (catch up if we jumped multiple splits).
    while (true) {
      const lastSplit = this.currentSession.splits[this.currentSession.splits.length - 1];
      const lastSplitDistance = lastSplit ? lastSplit.distance : 0;
      const nextSplitDistance = lastSplitDistance + SPLIT_DISTANCE_METERS;
      if (this.currentSession.distance < nextSplitDistance) break;

      const split: Split = {
        distance: nextSplitDistance,
        time: elapsedSeconds,
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
    // Kept for the whole row (issue #221, AC1.4). The previous 600-sample cap
    // silently discarded the opening of anything past ten minutes, so the
    // heartRateAvg/heartRateMax computed in endSession() described a truncated
    // window rather than the session.
    //
    // Footprint: a rower notifies at 4 Hz and a strap at 1 Hz, so an hour holds
    // roughly 18,000 samples — a few hundred kB of plain objects. The chart
    // reads only the last 120 (`HeartRateChart`'s maxPoints), so nothing
    // downstream walks the whole series on every frame.
    const sample: HeartRateSample = { bpm, timestamp: new Date() };
    this.currentSession.heartRateSamples.push(sample);
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
