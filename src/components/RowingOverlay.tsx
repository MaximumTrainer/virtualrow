import React, { useRef, useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import type { PM5Data, WorkoutProgress } from '../types/index';
import './RowingOverlay.css';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface RowingOverlayProps {
  pm5Data: PM5Data | null;
  heartRate: number | null;
  elapsedTimeMs: number;
  isPlaying: boolean;
  workoutProgress?: WorkoutProgress | null;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  onReset: () => void;
  paceHistory: Array<{ time: number; value: number }>;
  powerHistory: Array<{ time: number; value: number }>;
}

// Format time from milliseconds to HH:MM:SS
const formatTime = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// Format pace from seconds to MM:SS.s
const formatPace = (paceSeconds: number | null | undefined): string => {
  if (!paceSeconds || paceSeconds <= 0) return '--:--';
  const minutes = Math.floor(paceSeconds / 60);
  const seconds = (paceSeconds % 60).toFixed(1);
  return `${minutes}:${parseFloat(seconds) < 10 ? '0' : ''}${seconds}`;
};

// ============================================================================
// STROKE RHYTHM VISUALIZER - Pulsing wave animation
// ============================================================================
const StrokeRhythmVisualizer: React.FC<{ cadence: number; isActive: boolean }> = ({ cadence, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const phaseRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const animate = () => {
      const width = canvas.width;
      const height = canvas.height;
      
      // Clear canvas
      ctx.clearRect(0, 0, width, height);
      
      if (!isActive || cadence <= 0) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      // Calculate stroke frequency (strokes per second)
      const strokeFrequency = cadence / 60;
      const cycleTime = 1 / strokeFrequency;
      
      // Update phase
      phaseRef.current += (1 / 60) / cycleTime; // Assuming 60fps
      if (phaseRef.current > 1) phaseRef.current -= 1;

      // Draw wave
      ctx.beginPath();
      ctx.strokeStyle = '#00f5d4';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00f5d4';
      ctx.shadowBlur = 10;

      const amplitude = height * 0.35;
      const centerY = height / 2;
      
      // Calculate envelope for stroke power effect (used for wave and pulse)
      const envelope = Math.pow(Math.sin(phaseRef.current * Math.PI), 2);

      for (let x = 0; x < width; x++) {
        const normalizedX = x / width;
        // Create a wave that travels from left to right
        const wave = Math.sin((normalizedX - phaseRef.current) * Math.PI * 4);
        const y = centerY + wave * amplitude * (0.3 + envelope * 0.7);
        
        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Draw stroke pulse indicator
      const pulseSize = 8 + envelope * 12;
      const pulseX = width * 0.9;
      const pulseY = centerY;
      
      ctx.beginPath();
      ctx.arc(pulseX, pulseY, pulseSize, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 245, 212, ${0.3 + envelope * 0.7})`;
      ctx.fill();

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [cadence, isActive]);

  return (
    <div className="stroke-rhythm-container">
      <canvas 
        ref={canvasRef} 
        width={300} 
        height={60}
        className="stroke-rhythm-canvas"
      />
      <div className="stroke-rhythm-label">STROKE RHYTHM</div>
    </div>
  );
};

// ============================================================================
// PERFORMANCE GRAPH - Real-time line chart
// ============================================================================
const PerformanceGraph: React.FC<{
  data: Array<{ time: number; value: number }>;
  label: string;
  color: string;
  unit: string;
}> = ({ data, label, color, unit }) => {
  const chartData = {
    labels: data.slice(-30).map(d => d.time.toString()),
    datasets: [
      {
        label: label,
        data: data.slice(-30).map(d => d.value),
        borderColor: color,
        backgroundColor: `${color}33`,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
    scales: {
      x: {
        display: false,
        grid: { display: false },
      },
      y: {
        display: true,
        grid: { 
          color: 'rgba(255, 255, 255, 0.1)',
          drawBorder: false,
        },
        ticks: {
          color: 'rgba(255, 255, 255, 0.5)',
          font: { size: 10 },
          maxTicksLimit: 4,
        },
      },
    },
  };

  return (
    <div className="performance-graph">
      <div className="graph-header">
        <span className="graph-label">{label}</span>
        <span className="graph-value" style={{ color }}>
          {data.length > 0 ? data[data.length - 1].value.toFixed(1) : '--'} {unit}
        </span>
      </div>
      <div className="graph-container">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
};

// ============================================================================
// MAIN ROWING OVERLAY COMPONENT
// ============================================================================
export const RowingOverlay: React.FC<RowingOverlayProps> = ({
  pm5Data,
  heartRate,
  elapsedTimeMs,
  isPlaying,
  workoutProgress,
  onStart,
  onPause,
  onResume,
  onEnd,
  onReset,
  paceHistory,
  powerHistory,
}) => {
  const [isPaused, setIsPaused] = useState(false);

  // Extract metrics from PM5 data
  const distance = pm5Data?.distance ? (pm5Data.distance / 1000) : 0;
  const pace = pm5Data?.pace ? (pm5Data.pace / 100) : null;
  const cadence = pm5Data?.cadence || 0;
  const watts = pm5Data?.power || 0;
  const calories = pm5Data?.calories || 0;

  const handlePauseResume = () => {
    if (isPaused) {
      onResume();
      setIsPaused(false);
    } else {
      onPause();
      setIsPaused(true);
    }
  };

  return (
    <div className="rowing-overlay">
      {/* ============ TOP CENTER: Primary Metrics ============ */}
      <div className="overlay-panel primary-metrics">
        <div className="metric-group">
          <div className="metric large">
            <span className="metric-value accent-cyan">{distance.toFixed(2)}</span>
            <span className="metric-label">DISTANCE (km)</span>
          </div>
          <div className="metric large">
            <span className="metric-value accent-white">{formatTime(elapsedTimeMs)}</span>
            <span className="metric-label">TIME</span>
          </div>
          <div className="metric large">
            <span className="metric-value accent-pink">{cadence || '--'}</span>
            <span className="metric-label">SPM</span>
          </div>
        </div>
      </div>

      {/* ============ BOTTOM LEFT: Secondary Metrics ============ */}
      <div className="overlay-panel secondary-metrics bottom-left">
        <div className="metric-row">
          <div className="metric small">
            <span className="metric-icon">🔥</span>
            <div className="metric-content">
              <span className="metric-value">{calories}</span>
              <span className="metric-label">CALORIES</span>
            </div>
          </div>
          <div className="metric small">
            <span className="metric-icon">⏱️</span>
            <div className="metric-content">
              <span className="metric-value">{formatPace(pace)}</span>
              <span className="metric-label">/500m</span>
            </div>
          </div>
        </div>
        <div className="metric-row">
          <div className="metric small">
            <span className="metric-icon">❤️</span>
            <div className="metric-content">
              <span className="metric-value accent-pink">{heartRate || '--'}</span>
              <span className="metric-label">BPM</span>
            </div>
          </div>
          <div className="metric small">
            <span className="metric-icon">⚡</span>
            <div className="metric-content">
              <span className="metric-value accent-yellow">{watts}</span>
              <span className="metric-label">WATTS</span>
            </div>
          </div>
        </div>
      </div>

      {/* ============ BOTTOM CENTER: Stroke Rhythm Visualizer ============ */}
      <div className="overlay-panel rhythm-panel bottom-center">
        <StrokeRhythmVisualizer cadence={cadence} isActive={isPlaying && !isPaused} />
      </div>

      {/* ============ BOTTOM RIGHT: Performance Graph ============ */}
      <div className="overlay-panel graph-panel bottom-right">
        {powerHistory.length > 0 ? (
          <PerformanceGraph 
            data={powerHistory} 
            label="POWER" 
            color="#00f5d4" 
            unit="W"
          />
        ) : paceHistory.length > 0 ? (
          <PerformanceGraph 
            data={paceHistory.map(p => ({ time: p.time, value: 500 / p.value }))} 
            label="SPEED" 
            color="#ff006e" 
            unit="m/s"
          />
        ) : (
          <div className="graph-placeholder">
            <span>Performance data will appear here</span>
          </div>
        )}
      </div>

      {/* ============ TOP RIGHT: Session Controls ============ */}
      <div className="overlay-panel control-panel top-right">
        {workoutProgress && (
          <div className="workout-segment-info">
            <span className="segment-name">{workoutProgress.currentSegment?.description || workoutProgress.currentSegment?.type || 'Workout'}</span>
            <div className="segment-progress">
              <div 
                className="segment-progress-bar" 
                style={{ width: `${(workoutProgress.segmentProgress || 0)}%` }}
              />
            </div>
          </div>
        )}
        <div className="control-buttons">
          {!isPlaying ? (
            <button className="control-btn start" onClick={onStart}>
              <span className="btn-icon">▶</span>
              <span className="btn-text">START</span>
            </button>
          ) : (
            <>
              <button 
                className={`control-btn ${isPaused ? 'resume' : 'pause'}`} 
                onClick={handlePauseResume}
              >
                <span className="btn-icon">{isPaused ? '▶' : '⏸'}</span>
                <span className="btn-text">{isPaused ? 'RESUME' : 'PAUSE'}</span>
              </button>
              <button className="control-btn end" onClick={onEnd}>
                <span className="btn-icon">⏹</span>
                <span className="btn-text">END</span>
              </button>
            </>
          )}
          <button className="control-btn reset" onClick={onReset}>
            <span className="btn-icon">↺</span>
            <span className="btn-text">RESET</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default RowingOverlay;
