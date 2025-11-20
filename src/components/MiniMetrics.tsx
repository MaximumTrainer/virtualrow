import React from 'react';
import type { PM5Data } from '../types/index';
import './MiniMetrics.css';

interface MiniMetricsProps {
  pm5Data?: PM5Data | null;
  heartRate?: number | null;
}

export const MiniMetrics: React.FC<MiniMetricsProps> = ({ pm5Data, heartRate }) => {
  const pace = pm5Data?.pace ? (pm5Data.pace / 100).toFixed(1) : '--';
  const distance = pm5Data?.distance ? (pm5Data.distance / 1000).toFixed(2) : '--';
  return (
    <div className="mini-metrics">
      <div className="mini-metric">
        <div className="mini-label">Pace</div>
        <div className="mini-value">{pace}<span className="mini-unit"> s/500m</span></div>
      </div>
      <div className="mini-metric">
        <div className="mini-label">HR</div>
        <div className="mini-value">{heartRate ?? '--'}<span className="mini-unit"> bpm</span></div>
      </div>
      <div className="mini-metric">
        <div className="mini-label">Distance</div>
        <div className="mini-value">{distance}<span className="mini-unit"> km</span></div>
      </div>
    </div>
  );
};

export default MiniMetrics;
