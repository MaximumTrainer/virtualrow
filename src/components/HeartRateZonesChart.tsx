import { useMemo } from 'react';
import type { HeartRateSample } from '../types/index';
import './HeartRateZonesChart.css';

interface HeartRateZonesChartProps {
  samples: HeartRateSample[];
  maxHeartRate?: number; // User's max heart rate, defaults to 220 - age (assume 190 if not provided)
}

interface ZoneDefinition {
  name: string;
  minPercent: number;
  maxPercent: number;
  color: string;
  description: string;
}

const HR_ZONES: ZoneDefinition[] = [
  { name: 'Zone 1', minPercent: 50, maxPercent: 60, color: '#90EE90', description: 'Recovery' },
  { name: 'Zone 2', minPercent: 60, maxPercent: 70, color: '#87CEEB', description: 'Aerobic' },
  { name: 'Zone 3', minPercent: 70, maxPercent: 80, color: '#FFD700', description: 'Tempo' },
  { name: 'Zone 4', minPercent: 80, maxPercent: 90, color: '#FFA500', description: 'Threshold' },
  { name: 'Zone 5', minPercent: 90, maxPercent: 100, color: '#FF6347', description: 'Anaerobic' },
];

export function HeartRateZonesChart({ samples, maxHeartRate = 190 }: HeartRateZonesChartProps) {
  const zoneData = useMemo(() => {
    if (samples.length === 0) {
      return HR_ZONES.map(zone => ({
        ...zone,
        timeInZone: 0,
        percentage: 0,
      }));
    }

    // Calculate time spent in each zone
    const zoneCounts = HR_ZONES.map(() => 0);
    
    samples.forEach(sample => {
      const hrPercent = (sample.bpm / maxHeartRate) * 100;
      
      for (let i = 0; i < HR_ZONES.length; i++) {
        const zone = HR_ZONES[i];
        if (hrPercent >= zone.minPercent && hrPercent < zone.maxPercent) {
          zoneCounts[i]++;
          break;
        }
        // Handle Zone 5 upper bound (100%+)
        if (i === HR_ZONES.length - 1 && hrPercent >= zone.minPercent) {
          zoneCounts[i]++;
        }
      }
    });

    const totalSamples = samples.length;
    
    return HR_ZONES.map((zone, index) => ({
      ...zone,
      timeInZone: zoneCounts[index],
      percentage: totalSamples > 0 ? (zoneCounts[index] / totalSamples) * 100 : 0,
    }));
  }, [samples, maxHeartRate]);

  /**
   * Format sample count as time duration.
   * Note: This assumes heart rate samples are collected at approximately 1 sample per second,
   * which matches the typical HR monitor and PM5 update rate. The actual sample rate may vary
   * slightly based on device behavior.
   */
  const formatTime = (sampleCount: number): string => {
    const seconds = sampleCount;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (samples.length === 0) {
    return (
      <div className="hr-zones-chart">
        <h4>Heart Rate Zones</h4>
        <p className="no-data">No heart rate data available</p>
      </div>
    );
  }

  return (
    <div className="hr-zones-chart">
      <h4>Heart Rate Zones</h4>
      <div className="zones-container">
        {zoneData.map((zone) => (
          <div key={zone.name} className="zone-row">
            <div className="zone-label">
              <span className="zone-name">{zone.name}</span>
              <span className="zone-desc">{zone.description}</span>
            </div>
            <div className="zone-bar-container">
              <div 
                className="zone-bar" 
                style={{ 
                  width: `${Math.max(zone.percentage, 2)}%`,
                  backgroundColor: zone.color 
                }}
              />
            </div>
            <div className="zone-stats">
              <span className="zone-percentage">{zone.percentage.toFixed(1)}%</span>
              <span className="zone-time">{formatTime(zone.timeInZone)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="zones-legend">
        <span>Max HR: {maxHeartRate} bpm</span>
        <span>Total samples: {samples.length}</span>
      </div>
    </div>
  );
}
