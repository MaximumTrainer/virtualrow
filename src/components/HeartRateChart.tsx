import React, { useRef } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
  Filler,
  CategoryScale,
} from 'chart.js';
import type { ChartOptions, ScriptableLineSegmentContext, Chart } from 'chart.js';
import type { HeartRateSample } from '../types/index';

ChartJS.register(LineElement, PointElement, LinearScale, TimeScale, Tooltip, Legend, Filler, CategoryScale);

interface HeartRateChartProps {
  samples: HeartRateSample[];
  height?: number;
  maxPoints?: number;
}

export const HeartRateChart: React.FC<HeartRateChartProps> = ({ samples, height = 140, maxPoints = 120 }) => {
  const trimmed = samples.slice(-maxPoints);
  const smoothData = trimmed.map((_, idx) => {
    const start = Math.max(0, idx - Math.floor(5 / 2));
    const end = Math.min(trimmed.length, idx + Math.ceil(5 / 2));
    const slice = trimmed.slice(start, end);
    return Math.round(slice.reduce((s, v) => s + v.bpm, 0) / slice.length);
  });

  // Zone color function defined before data so segment can use it
  const zoneColor = (bpm: number) => {
    if (bpm < 90) return '#22c55e'; // recovery
    if (bpm < 120) return '#3b82f6'; // easy
    if (bpm < 150) return '#f59e0b'; // moderate
    if (bpm < 170) return '#ef4444'; // hard
    return '#b91c1c'; // intense
  };

  const data = {
    labels: trimmed.map((s) => s.timestamp.toLocaleTimeString()),
    datasets: [
      {
        label: 'Heart Rate (bpm)',
        data: trimmed.map((s) => s.bpm),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239,68,68,0.25)',
        tension: 0.35,
        pointRadius: 0,
        fill: true,
        segment: {
          borderColor: (ctx: ScriptableLineSegmentContext) => zoneColor(ctx.p0.parsed.y),
        },
      },
      {
        label: 'Smoothed',
        data: smoothData,
        borderColor: '#f87171',
        backgroundColor: 'transparent',
        tension: 0.2,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: { display: false },
      y: { display: true, ticks: { color: '#ef4444' } },
    },
  };

  const ref = useRef<ChartJS<'line'> | null>(null);

    const zoneBackground = {
    id: 'hrZonesBackground',
    beforeDraw: (chart: Chart) => {
      const { ctx, chartArea: { left, right }, scales: { y } } = chart;
      const zones = [
        { max: 90, color: 'rgba(34,197,94,0.10)' },
        { max: 120, color: 'rgba(59,130,246,0.08)' },
        { max: 150, color: 'rgba(245,158,11,0.08)' },
        { max: 170, color: 'rgba(239,68,68,0.08)' },
        { max: y.max, color: 'rgba(185,28,28,0.08)' },
      ];
      let prevMin = y.min;
      zones.forEach(z => {
        const yStart = y.getPixelForValue(prevMin);
        const yEnd = y.getPixelForValue(z.max);
        ctx.save();
        ctx.fillStyle = z.color;
        ctx.fillRect(left, yEnd, right - left, yStart - yEnd);
        ctx.restore();
        prevMin = z.max;
      });
    }
  };

  return (
    <div className="hr-chart-wrapper" style={{ height }}>
      <Line ref={ref} data={data} options={options} plugins={[zoneBackground]} />
    </div>
  );
};

export default HeartRateChart;
