import { useEffect, useRef, useMemo } from 'react';
import { Chart, registerables } from 'chart.js';
import type { ChartDataset, ScaleOptions } from 'chart.js';
import './PerformanceChart.css';

Chart.register(...registerables);

// Chart color constants for consistency
const CHART_COLORS = {
  pace: { border: '#667eea', background: 'rgba(102, 126, 234, 0.1)' },
  power: { border: '#22c55e', background: 'rgba(34, 197, 94, 0.1)' },
  heartRate: { border: '#ef4444', background: 'rgba(239, 68, 68, 0.1)' },
  distance: { border: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)' },
};

interface DataPoint {
  time: number; // elapsed time in seconds
  value: number;
}

interface PerformanceChartProps {
  paceData: DataPoint[];
  powerData?: DataPoint[];
  heartRateData?: DataPoint[];
  distanceData?: DataPoint[];
  showPace?: boolean;
  showPower?: boolean;
  showHeartRate?: boolean;
  showDistance?: boolean;
  maxPoints?: number;
}

export function PerformanceChart({
  paceData,
  powerData = [],
  heartRateData = [],
  distanceData = [],
  showPace = true,
  showPower = false,
  showHeartRate = true,
  showDistance = false,
  maxPoints = 60,
}: PerformanceChartProps) {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  // Limit data to maxPoints for performance
  const limitedData = useMemo(() => ({
    pace: paceData.slice(-maxPoints),
    power: powerData.slice(-maxPoints),
    heartRate: heartRateData.slice(-maxPoints),
    distance: distanceData.slice(-maxPoints),
  }), [paceData, powerData, heartRateData, distanceData, maxPoints]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (!chartRef.current) return;

    // Destroy existing chart
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
    }

    const ctx = chartRef.current.getContext('2d');
    if (!ctx) return;

    const datasets: ChartDataset<'line', number[]>[] = [];
    const labels = limitedData.pace.map(d => formatTime(d.time));

    if (showPace && limitedData.pace.length > 0) {
      datasets.push({
        label: 'Pace (s/500m)',
        data: limitedData.pace.map(d => d.value),
        borderColor: CHART_COLORS.pace.border,
        backgroundColor: CHART_COLORS.pace.background,
        tension: 0.4,
        fill: true,
        yAxisID: 'pace',
      });
    }

    if (showPower && limitedData.power.length > 0) {
      datasets.push({
        label: 'Power (W)',
        data: limitedData.power.map(d => d.value),
        borderColor: CHART_COLORS.power.border,
        backgroundColor: CHART_COLORS.power.background,
        tension: 0.4,
        fill: false,
        yAxisID: 'power',
      });
    }

    if (showHeartRate && limitedData.heartRate.length > 0) {
      datasets.push({
        label: 'Heart Rate (bpm)',
        data: limitedData.heartRate.map(d => d.value),
        borderColor: CHART_COLORS.heartRate.border,
        backgroundColor: CHART_COLORS.heartRate.background,
        tension: 0.4,
        fill: false,
        yAxisID: 'hr',
      });
    }

    if (showDistance && limitedData.distance.length > 0) {
      datasets.push({
        label: 'Distance (m)',
        data: limitedData.distance.map(d => d.value),
        borderColor: CHART_COLORS.distance.border,
        backgroundColor: CHART_COLORS.distance.background,
        tension: 0.4,
        fill: false,
        yAxisID: 'distance',
      });
    }

    const scales: Record<string, ScaleOptions<'linear'>> = {
      x: {
        display: true,
        title: {
          display: false,
        },
        ticks: {
          maxTicksLimit: 6,
          font: { size: 10 },
        },
      },
    };

    if (showPace) {
      scales.pace = {
        type: 'linear',
        position: 'left',
        title: { display: true, text: 'Pace (s/500m)', font: { size: 10 } },
        ticks: { font: { size: 10 } },
        reverse: true, // Lower pace is better
      };
    }

    if (showPower) {
      scales.power = {
        type: 'linear',
        position: 'right',
        title: { display: true, text: 'Power (W)', font: { size: 10 } },
        ticks: { font: { size: 10 } },
        grid: { drawOnChartArea: false },
      };
    }

    if (showHeartRate) {
      scales.hr = {
        type: 'linear',
        position: showPower ? 'left' : 'right',
        title: { display: true, text: 'HR (bpm)', font: { size: 10 } },
        ticks: { font: { size: 10 } },
        grid: { drawOnChartArea: false },
      };
    }

    if (showDistance) {
      scales.distance = {
        type: 'linear',
        position: 'right',
        title: { display: true, text: 'Distance (m)', font: { size: 10 } },
        ticks: { font: { size: 10 } },
        grid: { drawOnChartArea: false },
      };
    }

    chartInstanceRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false, // Disable animation for real-time updates
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              boxWidth: 12,
              font: { size: 10 },
            },
          },
        },
        scales,
        elements: {
          point: {
            radius: 0, // Hide points for cleaner look
          },
        },
      },
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [limitedData, showPace, showPower, showHeartRate, showDistance]);

  if (paceData.length === 0 && heartRateData.length === 0) {
    return (
      <div className="performance-chart">
        <h4>Performance</h4>
        <p className="no-data">No data yet. Start a workout to see real-time metrics.</p>
      </div>
    );
  }

  return (
    <div className="performance-chart">
      <h4>Real-time Performance</h4>
      <div className="chart-container">
        <canvas ref={chartRef} />
      </div>
    </div>
  );
}
