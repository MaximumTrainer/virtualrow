import type { ActivitySample, WorkoutSession } from '../types/index';
import { formatCourseMetres, formatPace, formatTime } from './formatters';

/**
 * The arithmetic of the post-row summary (#337): splits, the comparison with
 * this athlete's best on the route, the chart's series and the share card.
 * Pure, so the summary components only lay it out.
 */

export interface Split {
  /** Cumulative metres at the end of the split: 500, 1000, … */
  meters: number;
  /** Metres in this split: the interval, or less for the part-split a row ends on. */
  length: number;
  seconds: number;
  /** Pace over the split, per 500 m however long the split is. */
  paceSPer500: number;
  spm: number | null;
  watts: number | null;
  hr: number | null;
}

/** A part-split shorter than this is rounding, not rowing. */
const MIN_PART_SPLIT_METERS = 1;

const mean = (values: Array<number | undefined>): number | null => {
  const present = values.filter((v): v is number => v !== undefined && Number.isFinite(v));
  if (present.length === 0) return null;
  return Math.round(present.reduce((sum, v) => sum + v, 0) / present.length);
};

/** When, between two samples, the row passed `metres` — linear between them. */
const timeAt = (a: ActivitySample, b: ActivitySample, metres: number): number => {
  const span = b.distance - a.distance;
  if (span <= 0) return b.t;
  return a.t + ((metres - a.distance) / span) * (b.t - a.t);
};

export const splitsFrom = (samples: ActivitySample[], every = 500): Split[] => {
  if (samples.length < 2 || every <= 0) return [];
  const splits: Split[] = [];
  let startMetres = samples[0].distance;
  let startTime = samples[0].t;
  let inside: ActivitySample[] = [];

  const close = (endMetres: number, endTime: number) => {
    const length = endMetres - startMetres;
    const seconds = endTime - startTime;
    splits.push({
      meters: endMetres,
      length,
      seconds,
      paceSPer500: length > 0 ? (seconds * 500) / length : 0,
      spm: mean(inside.map((s) => s.cadence)),
      watts: mean(inside.map((s) => s.power)),
      hr: mean(inside.map((s) => s.heartRate)),
    });
    startMetres = endMetres;
    startTime = endTime;
    inside = [];
  };

  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    // Every boundary this step crossed, in case one step spans more than one.
    let boundary = (Math.floor(startMetres / every) + 1) * every;
    while (b.distance >= boundary) {
      // A sample belongs to the split it was taken in: one exactly on the
      // boundary ends this split, one past it starts the next, and is added
      // below once this one is closed.
      if (b.distance === boundary) inside.push(b);
      close(boundary, timeAt(a, b, boundary));
      boundary += every;
    }
    if (b.distance > startMetres) inside.push(b);
  }

  const last = samples[samples.length - 1];
  if (last.distance - startMetres >= MIN_PART_SPLIT_METERS) close(last.distance, last.t);
  return splits;
};

/** Seconds per 500 m against the best: negative is faster. Null on a first row. */
export const pbDelta = (avgPace: number, best: number | null): number | null =>
  best == null ? null : avgPace - best;

/** "−0:02", "+0:03", "±0:00" — the sign a rower reads first. */
export const formatPbDelta = (delta: number): string => {
  const whole = Math.round(Math.abs(delta));
  const sign = whole === 0 ? '±' : delta < 0 ? '−' : '+';
  return `${sign}${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/**
 * The fastest average split this athlete has rowed on this route before, from
 * the rows this browser kept for them. The row being summarised is left out,
 * since it is saved before the summary opens.
 */
export const bestPaceOnRoute = (history: WorkoutSession[], current: WorkoutSession): number | null => {
  const paces = history
    .filter((s) => s.routeId === current.routeId && s.id !== current.id && !s.isGuest)
    .map((s) => s.averagePace)
    .filter((p) => Number.isFinite(p) && p > 0);
  return paces.length > 0 ? Math.min(...paces) : null;
};

/** How many points the chart draws at most; a two-hour row is 7 200 samples. */
export const MAX_CHART_POINTS = 200;

export interface ChartSeries {
  km: number[];
  pace: Array<number | null>;
  hr: Array<number | null>;
}

export const chartSeries = (samples: ActivitySample[]): ChartSeries => {
  const step = Math.max(1, Math.ceil(samples.length / MAX_CHART_POINTS));
  const picked = samples.filter((_, i) => i % step === 0);
  // The last sample is where the row ended, so the line reaches the finish.
  const last = samples[samples.length - 1];
  if (last && picked[picked.length - 1] !== last) {
    if (picked.length >= MAX_CHART_POINTS) picked.pop();
    picked.push(last);
  }
  return {
    km: picked.map((s) => Math.round(s.distance / 10) / 100),
    pace: picked.map((s) => (s.pace && s.pace > 0 ? s.pace : null)),
    hr: picked.map((s) => (s.heartRate && s.heartRate > 0 ? s.heartRate : null)),
  };
};

export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;

export interface ShareCardLines {
  title: string;
  headline: string;
  detail: string;
}

export const shareCardLines = (session: WorkoutSession): ShareCardLines => ({
  title: session.routeName,
  headline: `${formatCourseMetres(session.distance)} m in ${formatTime(session.duration * 1000)}`,
  detail: `${formatPace(session.averagePace)} average`,
});

/** Draw the card onto a 2D context the size of `SHARE_CARD_SIZE`. */
export const drawShareCard = (ctx: CanvasRenderingContext2D, lines: ShareCardLines): void => {
  const { width, height } = SHARE_CARD_SIZE;
  const water = ctx.createLinearGradient(0, 0, 0, height);
  water.addColorStop(0, '#0b3954');
  water.addColorStop(1, '#087e8b');
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '600 44px system-ui, sans-serif';
  ctx.fillText(lines.title, 72, 140);
  ctx.font = '800 96px system-ui, sans-serif';
  ctx.fillText(lines.headline, 72, 330);
  ctx.font = '500 48px system-ui, sans-serif';
  ctx.fillText(lines.detail, 72, 420);
  ctx.globalAlpha = 0.7;
  ctx.font = '600 32px system-ui, sans-serif';
  ctx.fillText('VirtualRow', 72, height - 64);
  ctx.globalAlpha = 1;
};

/** The card as a PNG, drawn off-screen. Null where the browser cannot draw one. */
export const renderShareCard = (session: WorkoutSession): Promise<Blob | null> => {
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_CARD_SIZE.width;
  canvas.height = SHARE_CARD_SIZE.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  drawShareCard(ctx, shareCardLines(session));
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
};
