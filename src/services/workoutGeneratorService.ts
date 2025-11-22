import type { StructuredWorkout, WorkoutSegment, WorkoutProgress, PM5Data } from '../types/index';

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
        description: '5000m at steady aerobic pace',
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

    // Calculate total progress
    this.currentProgress.totalProgress = (this.currentProgress.totalElapsedTime / this.currentWorkout.totalDuration) * 100;

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
    this.workouts.push(workout);
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
  private convertIntervalsICUWorkout(icuWorkout: any): StructuredWorkout | null {
    try {
      const segments: WorkoutSegment[] = [];
      let order = 0;
      let totalDuration = 0;

      // Parse intervals.icu workout structure
      if (icuWorkout.steps) {
        icuWorkout.steps.forEach((step: any, index: number) => {
          const segment: WorkoutSegment = {
            id: `seg-${index}`,
            order: order++,
            type: this.mapICUStepType(step.type),
            duration: step.duration,
            distance: step.distance,
            targetPaceMin: step.target_pace ? step.target_pace - 5 : undefined,
            targetPaceMax: step.target_pace ? step.target_pace + 5 : undefined,
            targetPower: step.target_power,
            targetHeartRateMin: step.target_hr_min,
            targetHeartRateMax: step.target_hr_max,
            intensity: this.mapICUIntensity(step.intensity),
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
        type: this.mapICUWorkoutType(icuWorkout.type),
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
