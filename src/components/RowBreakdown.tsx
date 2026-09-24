import { useCallback, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import type { WorkoutSession } from '../types/index';
import { activityFileName, triggerBlobDownload } from '../utils/exporters';
import { formatCourseMetres, formatPace } from '../utils/formatters';
import {
  chartSeries,
  formatPbDelta,
  pbDelta,
  renderShareCard,
  splitsFrom,
} from '../utils/sessionSummary';
import './RowBreakdown.css';

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

/**
 * The row itself, under a summary's totals (#337): how it compares with this
 * athlete's best on the route, pace and heart rate over the distance, the
 * 500 m splits, and a card to share. Shared by the signed-in and the guest
 * summaries, which differ in what they can save, not in what the row was.
 */

interface RowBreakdownProps {
  session: WorkoutSession;
  /**
   * This athlete's best average split on the route before today, null for a
   * first row. Left out altogether where there is no history to ask, as for
   * a guest, and the comparison is not shown.
   */
  personalBest?: number | null;
}

/** m:ss, for a split or an axis tick. */
const clock = (seconds: number): string => {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

const orDash = (value: number | null) => (value === null ? '–' : String(value));

export function RowBreakdown({ session, personalBest }: RowBreakdownProps) {
  const splits = useMemo(() => splitsFrom(session.samples), [session.samples]);
  const series = useMemo(() => chartSeries(session.samples), [session.samples]);
  const [sharing, setSharing] = useState(false);

  const handleShare = useCallback(async () => {
    setSharing(true);
    try {
      const blob = await renderShareCard(session);
      if (blob) triggerBlobDownload(blob, 'image/png', activityFileName(session, 'png'));
    } finally {
      setSharing(false);
    }
  }, [session]);

  const delta = personalBest === undefined ? undefined : pbDelta(session.averagePace, personalBest);

  return (
    <div className="row-breakdown">
      {personalBest !== undefined && (
        <p
          className="row-breakdown-pb"
          data-testid="row-pb"
          data-trend={delta == null ? 'first' : delta < 0 ? 'faster' : delta > 0 ? 'slower' : 'level'}
        >
          {personalBest === null || delta == null
            ? 'First row on this route'
            : `Personal best ${formatPace(personalBest)} · ${formatPbDelta(delta)} today`}
        </p>
      )}

      {series.km.length > 1 && (
        <div className="row-breakdown-chart">
          <Line
            aria-label="Pace and heart rate over the row"
            role="img"
            data={{
              labels: series.km,
              datasets: [
                {
                  label: 'Pace (/500m)',
                  data: series.pace,
                  yAxisID: 'pace',
                  borderColor: '#0ea5e9',
                  pointRadius: 0,
                  borderWidth: 2,
                  spanGaps: true,
                },
                {
                  label: 'Heart rate (bpm)',
                  data: series.hr,
                  yAxisID: 'hr',
                  borderColor: '#ef4444',
                  pointRadius: 0,
                  borderWidth: 2,
                  spanGaps: true,
                },
              ],
            }}
            options={CHART_OPTIONS}
          />
        </div>
      )}

      {splits.length > 0 && (
        <table className="row-breakdown-splits" aria-label="Splits">
          <thead>
            <tr>
              <th scope="col">Distance</th>
              <th scope="col">Split</th>
              <th scope="col">SPM</th>
              <th scope="col">W</th>
              <th scope="col">HR</th>
            </tr>
          </thead>
          <tbody>
            {splits.map((split) => (
              <tr key={split.meters}>
                <td>{formatCourseMetres(split.meters)} m</td>
                <td>{clock(split.paceSPer500)}</td>
                <td>{orDash(split.spm)}</td>
                <td>{orDash(split.watts)}</td>
                <td>{orDash(split.hr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button className="btn btn-session-share" type="button" onClick={handleShare} disabled={sharing}>
        {sharing ? 'Drawing…' : '⇪ Share card'}
      </button>
    </div>
  );
}

/** Pace reads upward when it improves, as on an erg monitor's graph. */
const CHART_OPTIONS: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { position: 'bottom' } },
  scales: {
    x: { title: { display: true, text: 'km' }, ticks: { maxTicksLimit: 8 } },
    pace: {
      type: 'linear',
      position: 'left',
      reverse: true,
      ticks: { callback: (value) => clock(Number(value)) },
    },
    hr: { type: 'linear', position: 'right', grid: { drawOnChartArea: false } },
  },
};
