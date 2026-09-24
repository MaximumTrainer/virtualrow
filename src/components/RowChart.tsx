import React, { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler,
} from 'chart.js';
import type { ChartOptions, TooltipItem } from 'chart.js';
import { rowChartSeries } from '../utils/rowChartSeries';
import { formatSplit } from '../utils/formatters';
import type { ActivitySample } from '../types/index';
import './RowChart.css';

/**
 * The shape of the row, drawn over the distance it was rowed (#337).
 *
 * The splits table says what each 500 m cost; this says where inside them the
 * row was won or lost - the fast opening, the sag at 1200 m, the heart rate
 * that never came back down.
 */

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

export interface RowChartProps {
  samples: ActivitySample[];
  height?: number;
}

const PACE_LABEL = 'Pace (/500m)';
const HR_LABEL = 'Heart rate (bpm)';

const mean = (values: (number | null)[]): number | null => {
  const taken = values.filter((v): v is number => v !== null);
  return taken.length === 0 ? null : taken.reduce((sum, v) => sum + v, 0) / taken.length;
};

export const RowChart: React.FC<RowChartProps> = ({ samples, height = 220 }) => {
  const series = useMemo(() => rowChartSeries(samples), [samples]);

  if (series.metres.length === 0) return null;

  const data = {
    labels: series.metres,
    datasets: [
      {
        label: PACE_LABEL,
        data: series.pace,
        yAxisID: 'pace',
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56,189,248,0.18)',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        fill: true,
        // A gap in the recording is drawn as a gap, not spanned by a straight
        // line that claims a pace nothing measured.
        spanGaps: false,
      },
      {
        label: HR_LABEL,
        data: series.hr,
        yAxisID: 'hr',
        borderColor: '#ef4444',
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        spanGaps: false,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          // Chart.js would otherwise read a pace back as the raw 125 seconds
          // it is stored as. A rower rows to 2:05.
          label: (item: TooltipItem<'line'>) => {
            const value = item.parsed.y;
            if (value === null) return '';
            return item.dataset.label === PACE_LABEL
              ? `${formatSplit(value)} /500m`
              : `${Math.round(value)} bpm`;
          },
          title: (items: TooltipItem<'line'>[]) => `${items[0]?.label ?? ''} m`,
        },
      },
    },
    scales: {
      x: {
        type: 'category',
        ticks: { color: '#94a3b8', maxTicksLimit: 6, callback: (_v, i) => series.metres[i] },
        grid: { display: false },
      },
      /**
       * Quicker is a smaller number of seconds, so the axis runs the other way
       * up: a fast opening belongs at the top of the chart, where a rower
       * looks for it, not in the trough.
       */
      pace: {
        position: 'left',
        reverse: true,
        ticks: { color: '#38bdf8', callback: (value) => formatSplit(Number(value)) },
        grid: { color: 'rgba(148,163,184,0.15)' },
      },
      // Seconds per 500 m and beats per minute share no scale; on one axis
      // each flattens the other into a line that never moves.
      hr: {
        position: 'right',
        ticks: { color: '#ef4444' },
        grid: { display: false },
      },
    },
  };

  const averagePace = mean(series.pace);
  const averageHr = mean(series.hr);
  const furthest = series.metres[series.metres.length - 1];

  return (
    <figure className="row-chart" aria-label="Pace and heart rate over the row">
      <div className="row-chart-canvas" style={{ height }}>
        <Line data={data} options={options} />
      </div>
      {/*
        A canvas is a picture to a screen reader and nothing more (#344), so
        the reading it carries is given in text as well.
      */}
      <figcaption className="row-chart-caption">
        Pace and heart rate over {furthest} m
        {averagePace !== null && <> — averaging {formatSplit(averagePace)}/500m</>}
        {averageHr !== null && <> at {Math.round(averageHr)} bpm</>}.
      </figcaption>
    </figure>
  );
};

export default RowChart;
