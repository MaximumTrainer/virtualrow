import type { WorkoutProgress, WorkoutSegment } from '../types/index';
import './WorkoutProgressDisplay.css';

const POWER_TARGET_TOLERANCE_RATIO = 0.1;
const POWER_RATIO_CAP = 1.5;
// Keep marker vertical travel below the full bar height so it remains visible.
const POWER_MARKER_VERTICAL_SCALE_PERCENT = 70;
const POWER_MARKER_MIN_POSITION_PERCENT = 5;

interface WorkoutProgressDisplayProps {
  progress: WorkoutProgress | null;
  allSegments: WorkoutSegment[];
  currentPower?: number;
}

export function WorkoutProgressDisplay({ progress, allSegments, currentPower }: WorkoutProgressDisplayProps) {
  if (!progress) {
    return null;
  }

  if (progress.isComplete) {
    return (
      <div className="workout-progress-display workout-complete">
        <div className="workout-complete-banner">
          <span className="workout-complete-icon">🎉</span>
          <h3>Workout Complete!</h3>
          <p>Great work — all segments finished.</p>
        </div>
      </div>
    );
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getIntensityColor = (intensity?: string): string => {
    const colorMap: Record<string, string> = {
      'recovery': '#90EE90',
      'zone1': '#87CEEB',
      'zone2': '#FFD700',
      'zone3': '#FFA500',
      'zone4': '#FF6347',
      'zone5': '#FF0000',
      'max': '#8B0000',
    };
    return intensity ? colorMap[intensity] || '#CCC' : '#CCC';
  };

  const segment = progress.currentSegment;
  const totalTimelineDuration = allSegments.reduce((sum, seg) => sum + (seg.duration || 0), 0);
  const timelinePlayheadPercent = totalTimelineDuration > 0
    ? Math.min(100, (progress.totalElapsedTime / totalTimelineDuration) * 100)
    : progress.totalProgress;
  const currentSegmentTimeRemaining = segment.duration !== undefined
    ? Math.max(0, segment.duration - progress.segmentElapsedTime)
    : undefined;
  const powerStatus = (() => {
    if (!segment.targetPower || currentPower === undefined) return null;
    const tolerance = segment.targetPower * POWER_TARGET_TOLERANCE_RATIO;
    if (Math.abs(currentPower - segment.targetPower) <= tolerance) return 'on-target';
    return currentPower < segment.targetPower ? 'under-target' : 'over-target';
  })();
  const currentPowerRatio = segment.targetPower && currentPower !== undefined
    ? Math.min(POWER_RATIO_CAP, Math.max(0, currentPower / segment.targetPower))
    : undefined;
  const targetInfo = [];

  if (segment.targetPaceMin !== undefined && segment.targetPaceMax !== undefined) {
    targetInfo.push(`Pace: ${segment.targetPaceMin}-${segment.targetPaceMax}s/500m`);
  }
  if (segment.targetPower !== undefined) {
    targetInfo.push(`Power: ${segment.targetPower}W`);
  }
  if (segment.targetHeartRateMin !== undefined && segment.targetHeartRateMax !== undefined) {
    targetInfo.push(`HR: ${segment.targetHeartRateMin}-${segment.targetHeartRateMax}bpm`);
  }
  if (segment.cadence !== undefined) {
    targetInfo.push(`Cadence: ${segment.cadence}spm`);
  }

  return (
    <div className="workout-progress-display">
      <div className="progress-header">
        <h3>Workout Progress</h3>
        <div className="overall-progress">
          <span>{Math.round(progress.totalProgress)}%</span>
        </div>
      </div>

      <div className="current-segment">
        <div className="segment-info">
          <div className="segment-type" style={{ backgroundColor: getIntensityColor(segment.intensity) }}>
            {segment.type.toUpperCase()}
          </div>
          <div className="segment-details">
            <p className="segment-description">{segment.description || 'No description'}</p>
            {targetInfo.length > 0 && (
              <div className="target-info">
                {targetInfo.map((info, index) => (
                  <span key={index} className="target-item">{info}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="segment-progress-bar">
          <div
            className="segment-progress-fill"
            style={{
              width: `${progress.segmentProgress}%`,
              backgroundColor: progress.isOnTarget ? '#4CAF50' : '#FF9800',
            }}
          />
        </div>

        <div className="segment-stats">
          <span>Segment: {formatTime(progress.segmentElapsedTime)}</span>
          {segment.duration && <span>Target: {formatTime(segment.duration)}</span>}
        </div>
      </div>

      <div className={`target-indicator ${progress.isOnTarget ? 'on-target' : 'off-target'}`}>
        {progress.isOnTarget ? (
          <span>✓ On Target</span>
        ) : (
          <span>
            {progress.deviationPercent !== undefined && progress.deviationPercent > 0
              ? `↑ ${Math.abs(progress.deviationPercent).toFixed(0)}% too fast`
              : `↓ ${Math.abs(progress.deviationPercent || 0).toFixed(0)}% too slow`}
          </span>
        )}
      </div>

      <div className="upcoming-segments">
        <h4>Workout Structure</h4>
        <div className="segments-timeline">
          <div className="timeline-playhead" style={{ left: `${timelinePlayheadPercent}%` }} />
          {allSegments.map((seg, index) => (
            <div
              key={seg.id}
              className={`timeline-segment ${index === progress.currentSegmentIndex ? 'active' : ''} ${index < progress.currentSegmentIndex ? 'completed' : ''}`}
              style={{
                backgroundColor: getIntensityColor(seg.intensity),
                opacity: index < progress.currentSegmentIndex ? 0.5 : 1,
                flex: seg.duration || 1,
              }}
              title={`${seg.type}: ${seg.description || ''}`}
            >
              {index === progress.currentSegmentIndex && <span className="current-marker">▼</span>}
              {index === progress.currentSegmentIndex && powerStatus && currentPowerRatio !== undefined && (
                <span
                  className={`power-marker power-marker--${powerStatus}`}
                  style={{
                    bottom: `${Math.max(
                      POWER_MARKER_MIN_POSITION_PERCENT,
                      Math.min(100, currentPowerRatio * POWER_MARKER_VERTICAL_SCALE_PERCENT),
                    )}%`,
                  }}
                  aria-hidden="true"
                />
              )}
            </div>
          ))}
        </div>
        <div className="timeline-footer">
          {currentSegmentTimeRemaining !== undefined && (
            <span className="timeline-meta">
              Current interval: {formatTime(currentSegmentTimeRemaining)} remaining
            </span>
          )}
          {segment.targetPower !== undefined && currentPower !== undefined && (
            <span className={`timeline-power timeline-power--${powerStatus ?? 'neutral'}`}>
              Power {currentPower}W / Target {segment.targetPower}W
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
