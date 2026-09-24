import type { WorkoutSession } from '../types/index';
import { formatSplit } from '../utils/formatters';

/**
 * The row as a picture somebody can post (#337).
 *
 * Drawn here rather than sent anywhere: a rower who wants an image of their
 * morning row should not have to upload the row to a third party to get one
 * back. The card is a canvas, and the canvas never leaves the browser.
 */

/** The size a link preview crops to, so the card is not cropped for it. */
export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

export interface ShareCardStat {
  label: string;
  value: string;
}

export interface ShareCardContent {
  route: string;
  distance: string;
  time: string;
  pace: string;
  /** Only the readings the row actually took. */
  stats: ShareCardStat[];
  date: string;
}

const duration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
};

const averageOf = (session: WorkoutSession, pick: (s: WorkoutSession['samples'][number]) => number | undefined) => {
  const values = session.samples.map(pick).filter((v): v is number => v !== undefined && v > 0);
  return values.length === 0 ? null : Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
};

export const shareCardContent = (session: WorkoutSession): ShareCardContent => {
  const spm = averageOf(session, (s) => s.cadence);
  const watts = averageOf(session, (s) => s.power);
  const hr = session.heartRateAvg ?? averageOf(session, (s) => s.heartRate);

  // A field with no reading behind it would post a blank or, worse, a zero.
  // The card is a boast, not a data dump.
  const stats: ShareCardStat[] = [
    spm !== null && { label: 'Avg rate', value: `${spm} spm` },
    watts !== null && { label: 'Avg power', value: `${watts} W` },
    hr !== null && hr !== undefined && { label: 'Avg HR', value: `${hr} bpm` },
  ].filter((s): s is ShareCardStat => s !== false);

  return {
    route: session.routeName,
    distance: `${(session.distance / 1000).toFixed(2)} km`,
    time: duration(session.duration),
    pace: `${formatSplit(session.averagePace)}/500m`,
    stats,
    date: session.startTime.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  };
};

const INK = '#f8fafc';
const DIM = '#94a3b8';
const ACCENT = '#38bdf8';
const PAD = 80;

export const drawShareCard = (ctx: CanvasRenderingContext2D, content: ShareCardContent): void => {
  // Painted first and edge to edge: a PNG with no background is transparent,
  // and a transparent card reads as white text on white wherever it is posted.
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, 10);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.fillStyle = DIM;
  ctx.font = '600 30px system-ui, sans-serif';
  ctx.fillText(content.date.toUpperCase(), PAD, 110);

  ctx.fillStyle = INK;
  ctx.font = '700 64px system-ui, sans-serif';
  ctx.fillText(content.route, PAD, 190);

  // The three numbers a rower would say out loud, at the size they deserve.
  const headline: ShareCardStat[] = [
    { label: 'Distance', value: content.distance },
    { label: 'Time', value: content.time },
    { label: 'Split', value: content.pace },
  ];
  headline.forEach((stat, i) => {
    const x = PAD + i * 360;
    ctx.fillStyle = DIM;
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.fillText(stat.label.toUpperCase(), x, 300);
    ctx.fillStyle = INK;
    ctx.font = '700 82px system-ui, sans-serif';
    ctx.fillText(stat.value, x, 380);
  });

  content.stats.forEach((stat, i) => {
    const x = PAD + i * 360;
    ctx.fillStyle = DIM;
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillText(stat.label.toUpperCase(), x, 470);
    ctx.fillStyle = INK;
    ctx.font = '600 44px system-ui, sans-serif';
    ctx.fillText(stat.value, x, 522);
  });

  ctx.fillStyle = ACCENT;
  ctx.font = '700 30px system-ui, sans-serif';
  ctx.fillText('VirtualRow', PAD, SHARE_CARD_HEIGHT - 60);
};

/** `Willowbrook River` on 24 September 2026 → `willowbrook-river-2026-09-24`. */
const slug = (session: WorkoutSession): string => {
  const name = session.routeName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const d = session.startTime;
  const day = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
  return `${name}-${day}`;
};

export const shareCardFileName = (session: WorkoutSession): string => `virtualrow-${slug(session)}.png`;

/**
 * The card as a PNG blob.
 *
 * Rejects rather than resolving with nothing: the summary tells the rower that
 * the row itself is safe and only the picture failed, which it cannot do if a
 * failure looks the same as a success.
 */
export const shareCardBlob = async (session: WorkoutSession): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_CARD_WIDTH;
  canvas.height = SHARE_CARD_HEIGHT;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not draw the share card: this browser gave no 2D canvas.');

  drawShareCard(ctx, shareCardContent(session));

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not save the share card: the canvas produced no image.'));
    }, 'image/png');
  });
};
