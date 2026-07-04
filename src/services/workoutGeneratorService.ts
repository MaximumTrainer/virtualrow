import type { StructuredWorkout, WorkoutSegment, WorkoutProgress, PM5Data } from '../types/index';

interface ICUWorkoutStep {
  type?: string;
  duration?: number;
  distance?: number;
  target_pace?: number;
  target_power?: number;
  target_hr_min?: number;
  target_hr_max?: number;
  intensity?: string;
  repeat?: number;
  description?: string;
  name?: string;
}

interface ICUWorkoutData {
  id?: string;
  name?: string;
  description?: string;
  type?: string;
  steps?: ICUWorkoutStep[];
  distance?: number;
}

export class WorkoutGeneratorService {
  private workouts: StructuredWorkout[] = [];
  private currentWorkout: StructuredWorkout | null = null;
  private currentProgress: WorkoutProgress | null = null;

  constructor() {
    this.initializeSampleWorkouts();
  }

  // Initialize with some sample workouts
  private initializeSampleWorkouts(): void {
    const sampleWorkouts: StructuredWorkout[] = [
      {
        id: 'warmup-intervals-cooldown',
        name: '20min Pyramid Intervals',
        description: 'Classic pyramid interval workout: warmup, 4x4min intervals with rest, cooldown',
        type: 'pyramid',
        targetMetric: 'pace',
        totalDuration: 1200, // 20 minutes
        createdAt: new Date(),
        source: 'manual',
        segments: [
          {
            id: 'seg-1',
            order: 0,
            type: 'warmup',
            duration: 300, // 5 min
            intensity: 'zone1',
            description: 'Easy warmup pace',
            targetPaceMin: 135,
            targetPaceMax: 145,
          },
          {
            id: 'seg-2',
            order: 1,
            type: 'work',
            duration: 240, // 4 min
            intensity: 'zone4',
            description: 'Hard interval',
            targetPaceMin: 105,
            targetPaceMax: 115,
            repeat: 4,
          },
          {
            id: 'seg-3',
            order: 2,
            type: 'rest',
            duration: 60, // 1 min
            intensity: 'recovery',
            description: 'Active recovery',
            targetPaceMin: 140,
            targetPaceMax: 155,
          },
          {
            id: 'seg-4',
            order: 3,
            type: 'cooldown',
            duration: 300, // 5 min
            intensity: 'zone1',
            description: 'Easy cooldown',
            targetPaceMin: 135,
            targetPaceMax: 150,
          },
        ],
      },
      {
        id: 'steady-state-5k',
        name: '5K Steady State',
        description: '5000m at steady aerobic pace - can be done on any route or no route',
        type: 'steady-state',
        targetMetric: 'pace',
        totalDuration: 1200, // ~20 min at 2:00/500m pace
        totalDistance: 5000,
        createdAt: new Date(),
        source: 'manual',
        segments: [
          {
            id: 'seg-1',
            order: 0,
            type: 'work',
            distance: 5000,
            intensity: 'zone2',
            description: 'Steady state pace',
            targetPaceMin: 115,
            targetPaceMax: 125,
            cadence: 20,
          },
        ],
      },
      {
        id: 'tabata-intervals',
        name: 'Tabata Intervals (16min)',
        description: '8 rounds of 20sec max effort / 10sec rest. High intensity interval training.',
        type: 'intervals',
        targetMetric: 'pace',
        totalDuration: 960, // 16 minutes
        createdAt: new Date(),
        source: 'manual',
        segments: [
          {
            id: 'tabata-warmup',
            order: 0,
            type: 'warmup',
            duration: 300, // 5 min
            intensity: 'zone1',
            description: 'Warmup',
            targetPaceMin: 135,
            targetPaceMax: 145,
          },
          {
            id: 'tabata-work',
            order: 1,
            type: 'interval',
            duration: 20,
            intensity: 'max',
            description: 'Max effort',
            targetPaceMin: 85,
            targetPaceMax: 95,
            repeat: 8,
          },
          {
            id: 'tabata-rest',
            order: 2,
            type: 'rest',
            duration: 10,
            intensity: 'recovery',
            description: 'Rest',
          },
          {
            id: 'tabata-cooldown',
            order: 3,
            type: 'cooldown',
            duration: 300, // 5 min
            intensity: 'zone1',
            description: 'Cooldown',
            targetPaceMin: 135,
            targetPaceMax: 150,
          },
        ],
      },
      {
        id: 'venice-tour',
        name: 'Venice Grand Canal Tour',
        description: 'Scenic 3.65km row through Venice with easy pace to enjoy the sights',
        type: 'steady-state',
        targetMetric: 'pace',
        totalDuration: 900, // 15 minutes
        totalDistance: 3650,
        routeId: '1', // Venice route
        createdAt: new Date(),
        source: 'manual',
        segments: [
          {
            id: 'venice-1',
            order: 0,
            type: 'work',
            distance: 3650,
            intensity: 'zone1',
            description: 'Easy touring pace through Venice canals',
            targetPaceMin: 140,
            targetPaceMax: 150,
            cadence: 18,
          },
        ],
      },
      {
        id: 'henley-race-pace',
        name: 'Henley Regatta Race Pace',
        description: 'Simulate a Henley race: 2km warmup, 7km at race pace on the Henley course',
        type: 'steady-state',
        targetMetric: 'pace',
        totalDuration: 1800, // 30 minutes
        totalDistance: 9000,
        routeId: '2', // Henley route
        createdAt: new Date(),
        source: 'manual',
        segments: [
          {
            id: 'henley-warmup',
            order: 0,
            type: 'warmup',
            distance: 2000,
            intensity: 'zone1',
            description: 'Warmup',
            targetPaceMin: 130,
            targetPaceMax: 140,
          },
          {
            id: 'henley-race',
            order: 1,
            type: 'work',
            distance: 7000,
            intensity: 'zone4',
            description: 'Race pace effort',
            targetPaceMin: 100,
            targetPaceMax: 110,
            cadence: 32,
          },
        ],
      },
      {
        id: 'long-distance-endurance',
        name: 'Long Distance Endurance (45min)',
        description: 'Extended aerobic training session at conversational pace - no specific route required',
        type: 'steady-state',
        targetMetric: 'time',
        totalDuration: 2700, // 45 minutes
        createdAt: new Date(),
        source: 'manual',
        segments: [
          {
            id: 'lde-main',
            order: 0,
            type: 'work',
            duration: 2700,
            intensity: 'zone2',
            description: 'Steady aerobic pace',
            targetPaceMin: 120,
            targetPaceMax: 130,
            cadence: 20,
          },
        ],
      },
      {
        id: '2k-test',
        name: '2K Time Trial',
        description: 'Classic 2000m test: max effort to establish baseline fitness',
        type: 'custom',
        targetMetric: 'distance',
        totalDuration: 480, // ~8 minutes for most rowers
        totalDistance: 2000,
        createdAt: new Date(),
        source: 'manual',
        segments: [
          {
            id: '2k-warmup',
            order: 0,
            type: 'warmup',
            distance: 1000,
            intensity: 'zone1',
            description: 'Warmup',
            targetPaceMin: 130,
            targetPaceMax: 145,
          },
          {
            id: '2k-test',
            order: 1,
            type: 'work',
            distance: 2000,
            intensity: 'zone5',
            description: 'Max effort - give it everything!',
            targetPaceMin: 90,
            targetPaceMax: 105,
            cadence: 34,
          },
          {
            id: '2k-cooldown',
            order: 2,
            type: 'cooldown',
            distance: 1000,
            intensity: 'recovery',
            description: 'Cool down',
            targetPaceMin: 140,
            targetPaceMax: 160,
          },
        ],
      },
      {
        id: 'power-pyramid',
        name: 'Power Pyramid (30min)',
        description: 'Progressive power intervals: 1-2-3-4-3-2-1 minute efforts',
        type: 'pyramid',
        targetMetric: 'power',
        totalDuration: 1800, // 30 minutes
        createdAt: new Date(),
        source: 'manual',
        segments: [
          {
            id: 'pp-warmup',
            order: 0,
            type: 'warmup',
            duration: 300, // 5 min
            intensity: 'zone1',
            description: 'Warmup',
            targetPaceMin: 135,
            targetPaceMax: 145,
          },
          {
            id: 'pp-1min',
            order: 1,
            type: 'interval',
            duration: 60,
            intensity: 'zone4',
            description: '1min effort',
            targetPower: 200,
          },
          {
            id: 'pp-rest-1',
            order: 2,
            type: 'rest',
            duration: 60,
            intensity: 'recovery',
            description: 'Rest',
          },
          {
            id: 'pp-2min',
            order: 3,
            type: 'interval',
            duration: 120,
            intensity: 'zone4',
            description: '2min effort',
            targetPower: 190,
          },
          {
            id: 'pp-rest-2',
            order: 4,
            type: 'rest',
            duration: 90,
            intensity: 'recovery',
            description: 'Rest',
          },
          {
            id: 'pp-3min',
            order: 5,
            type: 'interval',
            duration: 180,
            intensity: 'zone3',
            description: '3min effort',
            targetPower: 180,
          },
          {
            id: 'pp-rest-3',
            order: 6,
            type: 'rest',
            duration: 120,
            intensity: 'recovery',
            description: 'Rest',
          },
          {
            id: 'pp-4min',
            order: 7,
            type: 'interval',
            duration: 240,
            intensity: 'zone3',
            description: '4min effort (peak)',
            targetPower: 175,
          },
          {
            id: 'pp-rest-4',
            order: 8,
            type: 'rest',
            duration: 120,
            intensity: 'recovery',
            description: 'Rest',
          },
          {
            id: 'pp-3min-down',
            order: 9,
            type: 'interval',
            duration: 180,
            intensity: 'zone3',
            description: '3min effort',
            targetPower: 180,
          },
          {
            id: 'pp-rest-5',
            order: 10,
            type: 'rest',
            duration: 90,
            intensity: 'recovery',
            description: 'Rest',
          },
          {
            id: 'pp-2min-down',
            order: 11,
            type: 'interval',
            duration: 120,
            intensity: 'zone4',
            description: '2min effort',
            targetPower: 190,
          },
          {
            id: 'pp-rest-6',
            order: 12,
            type: 'rest',
            duration: 60,
            intensity: 'recovery',
            description: 'Rest',
          },
          {
            id: 'pp-1min-down',
            order: 13,
            type: 'interval',
            duration: 60,
            intensity: 'zone4',
            description: '1min effort',
            targetPower: 200,
          },
          {
            id: 'pp-cooldown',
            order: 14,
            type: 'cooldown',
            duration: 180, // 3 min
            intensity: 'zone1',
            description: 'Cooldown',
            targetPaceMin: 135,
            targetPaceMax: 150,
          },
        ],
      },
    ];

    this.workouts = sampleWorkouts;
  }

  // Get all available workouts
  getAllWorkouts(): StructuredWorkout[] {
    return [...this.workouts];
  }

  // Get workout by ID
  getWorkoutById(id: string): StructuredWorkout | undefined {
    return this.workouts.find(w => w.id === id);
  }

  // Start a structured workout
  startWorkout(workoutId: string): WorkoutProgress | null {
    const workout = this.getWorkoutById(workoutId);
    if (!workout) return null;

    this.currentWorkout = workout;
    
    // Expand repeating segments for easier tracking
    const expandedSegments = this.expandSegments(workout.segments);
    
    this.currentProgress = {
      workoutId: workout.id,
      currentSegmentIndex: 0,
      currentSegment: expandedSegments[0],
      segmentElapsedTime: 0,
      segmentProgress: 0,
      totalElapsedTime: 0,
      totalProgress: 0,
      isOnTarget: true,
      deviationPercent: 0,
    };

    return this.currentProgress;
  }

  // Expand segments with repeat property into individual segments
  expandSegments(segments: WorkoutSegment[]): WorkoutSegment[] {
    const expanded: WorkoutSegment[] = [];
    
    segments.forEach((segment) => {
      if (segment.repeat && segment.repeat > 1) {
        // Create multiple copies of the segment
        for (let i = 0; i < segment.repeat; i++) {
          expanded.push({
            ...segment,
            id: `${segment.id}-rep-${i + 1}`,
            repeat: undefined, // Clear repeat on expanded segments
          });
        }
      } else {
        expanded.push(segment);
      }
    });

    return expanded;
  }

  // Update workout progress based on PM5 data
  updateProgress(pm5Data: PM5Data): WorkoutProgress | null {
    if (!this.currentProgress || !this.currentWorkout) return null;

    const elapsedSeconds = Math.floor(pm5Data.elapsedTime / 1000);
    this.currentProgress.totalElapsedTime = elapsedSeconds;

    // Update segment progress
    this.currentProgress.segmentElapsedTime = elapsedSeconds - this.getSegmentStartTime(this.currentProgress.currentSegmentIndex);

    const segment = this.currentProgress.currentSegment;
    
    // Calculate segment progress percentage
    if (segment.duration) {
      this.currentProgress.segmentProgress = Math.min(100, (this.currentProgress.segmentElapsedTime / segment.duration) * 100);
      
      // Move to next segment if current is complete
      if (this.currentProgress.segmentElapsedTime >= segment.duration) {
        this.advanceToNextSegment();
      }
    } else if (segment.distance) {
      // Distance-based segment
      const segmentStartDistance = this.getSegmentStartDistance(this.currentProgress.currentSegmentIndex);
      const distanceInSegment = pm5Data.distance - segmentStartDistance;
      this.currentProgress.segmentProgress = Math.min(100, (distanceInSegment / segment.distance) * 100);
      
      if (distanceInSegment >= segment.distance) {
        this.advanceToNextSegment();
      }
    }

    // Calculate total progress — capped at 100 when the workout is complete
    if (!this.currentProgress.isComplete) {
      this.currentProgress.totalProgress = Math.min(
        100,
        (this.currentProgress.totalElapsedTime / this.currentWorkout.totalDuration) * 100,
      );
    }

    // Check if on target
    this.checkTargetCompliance(pm5Data);

    return this.currentProgress;
  }

  // Get the start time for a specific segment
  private getSegmentStartTime(segmentIndex: number): number {
    if (!this.currentWorkout) return 0;
    
    const expandedSegments = this.expandSegments(this.currentWorkout.segments);
    let startTime = 0;
    
    for (let i = 0; i < segmentIndex; i++) {
      startTime += expandedSegments[i].duration || 0;
    }
    
    return startTime;
  }

  // Get the start distance for a specific segment
  private getSegmentStartDistance(segmentIndex: number): number {
    if (!this.currentWorkout) return 0;
    
    const expandedSegments = this.expandSegments(this.currentWorkout.segments);
    let startDistance = 0;
    
    for (let i = 0; i < segmentIndex; i++) {
      startDistance += expandedSegments[i].distance || 0;
    }
    
    return startDistance;
  }

  // Advance to the next segment in the workout
  private advanceToNextSegment(): void {
    if (!this.currentProgress || !this.currentWorkout) return;

    const expandedSegments = this.expandSegments(this.currentWorkout.segments);
    const nextIndex = this.currentProgress.currentSegmentIndex + 1;

    if (nextIndex < expandedSegments.length) {
      this.currentProgress.currentSegmentIndex = nextIndex;
      this.currentProgress.currentSegment = expandedSegments[nextIndex];
      this.currentProgress.segmentElapsedTime = 0;
      this.currentProgress.segmentProgress = 0;
    } else {
      // Final segment completed — mark the workout as complete
      this.currentProgress.isComplete = true;
      this.currentProgress.segmentProgress = 100;
      this.currentProgress.totalProgress = 100;
    }
  }

  // Check if user is meeting target metrics
  private checkTargetCompliance(pm5Data: PM5Data): void {
    if (!this.currentProgress) return;

    const segment = this.currentProgress.currentSegment;
    let isOnTarget = true;
    let deviation = 0;

    // Check pace targets
    if (segment.targetPaceMin !== undefined && segment.targetPaceMax !== undefined && pm5Data.pace) {
      if (pm5Data.pace < segment.targetPaceMin) {
        // Going too fast (lower pace number = faster)
        isOnTarget = false;
        deviation = ((segment.targetPaceMin - pm5Data.pace) / segment.targetPaceMin) * 100;
      } else if (pm5Data.pace > segment.targetPaceMax) {
        // Going too slow (higher pace number = slower)
        isOnTarget = false;
        deviation = -((pm5Data.pace - segment.targetPaceMax) / segment.targetPaceMax) * 100;
      }
    }

    // Check power targets
    if (segment.targetPower !== undefined && pm5Data.power) {
      const tolerance = segment.targetPower * 0.1; // 10% tolerance
      if (Math.abs(pm5Data.power - segment.targetPower) > tolerance) {
        isOnTarget = false;
        deviation = ((pm5Data.power - segment.targetPower) / segment.targetPower) * 100;
      }
    }

    // Check heart rate targets
    if (segment.targetHeartRateMin !== undefined && segment.targetHeartRateMax !== undefined && pm5Data.heartRate) {
      if (pm5Data.heartRate < segment.targetHeartRateMin || pm5Data.heartRate > segment.targetHeartRateMax) {
        isOnTarget = false;
        deviation = pm5Data.heartRate < segment.targetHeartRateMin
          ? -((segment.targetHeartRateMin - pm5Data.heartRate) / segment.targetHeartRateMin) * 100
          : ((pm5Data.heartRate - segment.targetHeartRateMax) / segment.targetHeartRateMax) * 100;
      }
    }

    this.currentProgress.isOnTarget = isOnTarget;
    this.currentProgress.deviationPercent = deviation;
  }

  // Get current workout progress
  getCurrentProgress(): WorkoutProgress | null {
    return this.currentProgress;
  }

  // Get current workout
  getCurrentWorkout(): StructuredWorkout | null {
    return this.currentWorkout;
  }

  // End current workout
  endWorkout(): void {
    this.currentWorkout = null;
    this.currentProgress = null;
  }

  // Add a new workout
  addWorkout(workout: StructuredWorkout): void {
    const existingIndex = this.workouts.findIndex((candidate) => candidate.id === workout.id);
    if (existingIndex >= 0) {
      this.workouts[existingIndex] = workout;
      return;
    }
    this.workouts.push(workout);
  }

  getExpandedCurrentSegments(): WorkoutSegment[] {
    if (!this.currentWorkout) return [];
    return this.expandSegments(this.currentWorkout.segments);
  }

  // Import workout from intervals.icu format
  async importFromIntervalsICU(apiKey: string, athleteId: string, workoutId: string): Promise<StructuredWorkout | null> {
    try {
      const response = await fetch(
        `https://intervals.icu/api/v1/athlete/${athleteId}/workouts/${workoutId}`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch workout: ${response.statusText}`);
      }

      const data = await response.json();
      const structuredWorkout = this.convertIntervalsICUWorkout(data);
      
      if (structuredWorkout) {
        this.addWorkout(structuredWorkout);
      }

      return structuredWorkout;
    } catch (error) {
      console.error('Error importing from intervals.icu:', error);
      return null;
    }
  }


  // Convert intervals.icu workout format to our format
  private convertIntervalsICUWorkout(icuWorkout: ICUWorkoutData): StructuredWorkout | null {
    try {
      const segments: WorkoutSegment[] = [];
      let order = 0;
      let totalDuration = 0;

      // Parse intervals.icu workout structure
      if (icuWorkout.steps) {
        icuWorkout.steps.forEach((step: ICUWorkoutStep, index: number) => {
          const segment: WorkoutSegment = {
            id: `seg-${index}`,
            order: order++,
            type: this.mapICUStepType(step.type ?? ''),
            duration: step.duration,
            distance: step.distance,
            targetPaceMin: step.target_pace ? step.target_pace - 5 : undefined,
            targetPaceMax: step.target_pace ? step.target_pace + 5 : undefined,
            targetPower: step.target_power,
            targetHeartRateMin: step.target_hr_min,
            targetHeartRateMax: step.target_hr_max,
            intensity: this.mapICUIntensity(step.intensity ?? ''),
            repeat: step.repeat || 1,
            description: step.description || step.name,
          };

          segments.push(segment);
          totalDuration += (step.duration || 0) * (step.repeat || 1);
        });
      }

      const workout: StructuredWorkout = {
        id: `icu-${icuWorkout.id}`,
        name: icuWorkout.name || 'Imported Workout',
        description: icuWorkout.description || '',
        type: this.mapICUWorkoutType(icuWorkout.type ?? ''),
        segments,
        totalDuration,
        totalDistance: icuWorkout.distance,
        targetMetric: 'pace',
        createdAt: new Date(),
        source: 'intervals.icu',
        externalId: icuWorkout.id,
      };

      return workout;
    } catch (error) {
      console.error('Error converting intervals.icu workout:', error);
      return null;
    }
  }

  // Map intervals.icu step types to our types
  private mapICUStepType(icuType: string): WorkoutSegment['type'] {
    const typeMap: Record<string, WorkoutSegment['type']> = {
      'warmup': 'warmup',
      'work': 'work',
      'interval': 'interval',
      'rest': 'rest',
      'cooldown': 'cooldown',
      'recovery': 'rest',
    };
    return typeMap[icuType?.toLowerCase()] || 'work';
  }

  // Map intervals.icu intensity to our zones
  private mapICUIntensity(icuIntensity: string | number): WorkoutSegment['intensity'] {
    if (typeof icuIntensity === 'number') {
      if (icuIntensity <= 1) return 'recovery';
      if (icuIntensity <= 2) return 'zone1';
      if (icuIntensity <= 3) return 'zone2';
      if (icuIntensity <= 4) return 'zone3';
      if (icuIntensity <= 5) return 'zone4';
      return 'zone5';
    }
    
    const intensityMap: Record<string, WorkoutSegment['intensity']> = {
      'recovery': 'recovery',
      'easy': 'zone1',
      'moderate': 'zone2',
      'tempo': 'zone3',
      'threshold': 'zone4',
      'vo2max': 'zone5',
      'max': 'max',
    };
    return intensityMap[icuIntensity?.toLowerCase()] || 'zone2';
  }

  // Map intervals.icu workout type to our types
  private mapICUWorkoutType(icuType: string): StructuredWorkout['type'] {
    const typeMap: Record<string, StructuredWorkout['type']> = {
      'intervals': 'intervals',
      'steady': 'steady-state',
      'pyramid': 'pyramid',
      'custom': 'custom',
    };
    return typeMap[icuType?.toLowerCase()] || 'custom';
  }

  // Calculate target pace adjustment factor based on workout demands
  // This can be used to visualize speed adjustments in the 3D view
  getSpeedAdjustmentFactor(): number {
    if (!this.currentProgress) return 1.0;

    const segment = this.currentProgress.currentSegment;
    
    // Map intensity to speed factor
    const intensityMap: Record<string, number> = {
      'recovery': 0.6,
      'zone1': 0.7,
      'zone2': 0.8,
      'zone3': 0.9,
      'zone4': 1.0,
      'zone5': 1.1,
      'max': 1.2,
    };

    return segment.intensity ? intensityMap[segment.intensity] || 1.0 : 1.0;
  }
}

export const workoutGeneratorService = new WorkoutGeneratorService();
