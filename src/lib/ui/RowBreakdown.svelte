<!--
  RowBreakdown (#337, ported to Svelte for #542 P1). The row itself, under a
  summary's totals: how it compares with this athlete's best on the route, pace
  and heart rate over the distance, the 500 m splits, and a card to share.
  Shared by the signed-in and the guest summaries, which differ in what they
  can save, not in what the row was. DOM, class names, data-testid and copy
  kept verbatim vs the React component so the Playwright selectors keep
  resolving. The chart is Chart.js directly (the React version used the
  react-chartjs-2 wrapper); a `<canvas data-testid="row-chart">` the engine of
  the chart draws into.
-->
<script lang="ts">
  import {
    CategoryScale,
    Chart,
    Legend,
    LinearScale,
    LineController,
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

  Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

  interface Props {
    session: WorkoutSession;
    /**
     * This athlete's best average split on the route before today, null for a
     * first row. Left out altogether where there is no history to ask, as for
     * a guest, and the comparison is not shown.
     */
    personalBest?: number | null;
  }

  let { session, personalBest }: Props = $props();

  /** m:ss, for a split or an axis tick. */
  const clock = (seconds: number): string => {
    const whole = Math.round(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  };

  const orDash = (value: number | null) => (value === null ? '–' : String(value));

  const splits = $derived(splitsFrom(session.samples));
  const series = $derived(chartSeries(session.samples));
  let sharing = $state(false);

  const delta = $derived(
    personalBest === undefined ? undefined : pbDelta(session.averagePace, personalBest),
  );
  const trend = $derived(
    delta == null ? 'first' : delta < 0 ? 'faster' : delta > 0 ? 'slower' : 'level',
  );

  async function handleShare() {
    sharing = true;
    try {
      const blob = await renderShareCard(session);
      if (blob) triggerBlobDownload(blob, 'image/png', activityFileName(session, 'png'));
    } finally {
      sharing = false;
    }
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

  let canvas = $state<HTMLCanvasElement | null>(null);

  // Draw (and redraw) the chart whenever the canvas mounts or the series
  // changes; tear the instance down on cleanup so a re-render never leaks one.
  $effect(() => {
    const el = canvas;
    if (!el) return;
    const data = {
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
    };
    const chart = new Chart(el, { type: 'line', data, options: CHART_OPTIONS });
    return () => chart.destroy();
  });
</script>

<div class="row-breakdown">
  {#if personalBest !== undefined}
    <p class="row-breakdown-pb" data-testid="row-pb" data-trend={trend}>
      {#if personalBest === null || delta == null}
        First row on this route
      {:else}
        Personal best {formatPace(personalBest)} · {formatPbDelta(delta)} today
      {/if}
    </p>
  {/if}

  {#if series.km.length > 1}
    <div class="row-breakdown-chart">
      <!-- role/aria-label kept verbatim from the React chart so the a11y label survives; the chart engine draws into this canvas. -->
      <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
      <canvas bind:this={canvas} data-testid="row-chart" role="img" aria-label="Pace and heart rate over the row"></canvas>
    </div>
  {/if}

  {#if splits.length > 0}
    <table class="row-breakdown-splits" aria-label="Splits">
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
        {#each splits as split (split.meters)}
          <tr>
            <td>{formatCourseMetres(split.meters)} m</td>
            <td>{clock(split.paceSPer500)}</td>
            <td>{orDash(split.spm)}</td>
            <td>{orDash(split.watts)}</td>
            <td>{orDash(split.hr)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <button class="btn btn-session-share" type="button" onclick={handleShare} disabled={sharing}>
    {sharing ? 'Drawing…' : '⇪ Share card'}
  </button>
</div>
