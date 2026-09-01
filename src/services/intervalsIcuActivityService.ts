/**
 * Uploads a completed row to intervals.icu as a FIT activity (issue #221, R3).
 *
 * ```
 * POST {PROXY_BASE}/api/v1/athlete/0/activities
 *      ?name=<route>&description=<...>&external_id=virtualrow-<session id>
 * Authorization: Bearer <access token>
 * Content-Type: multipart/form-data   (file part, "<name>.fit")
 * ```
 *
 * Athlete `0` means "the authenticated athlete", which sidesteps the `i{id}`
 * fallback the events endpoint needs. `ACTIVITY:WRITE` is already among the
 * scopes requested at login, so no consent change is required.
 *
 * The multipart POST was verified end to end through the CORS proxy before
 * this shipped; see MaximumTrainer/MaximumTrainer_Redux#359 for what the
 * worker does and does not do.
 */
import type { WorkoutSession } from '../types/index';
import { PROXY_BASE } from './authService';
import { activityFileName } from '../utils/exporters';

const ACTIVITIES_PATH = '/api/v1/athlete/0/activities';
const ACTIVITY_BASE_URL = 'https://intervals.icu/activities';

/** The outcome of an upload attempt. */
export type ActivityUploadResult =
  | { status: 'uploaded'; activityId: string; activityUrl: string }
  | { status: 'already-uploaded'; activityId: string; activityUrl: string }
  | { status: 'auth-expired'; message: string }
  | { status: 'failed'; message: string };

/**
 * The auth surface an upload needs. `AuthService` satisfies it structurally,
 * so the composition root passes the real service and a test passes a stub.
 */
export interface ActivityUploadAuth {
  getAccessToken(): string | null;
  refreshAccessToken(): Promise<boolean>;
}

const EXPIRED_MESSAGE = 'Your intervals.icu session expired — sign in again.';

/** intervals.icu returns the created activity, sometimes wrapped in an array. */
interface RawActivityResponse {
  id?: string | number;
  error?: string;
  message?: string;
}

function externalId(session: WorkoutSession): string {
  return `virtualrow-${session.id}`;
}

function activityUrl(activityId: string): string {
  return `${ACTIVITY_BASE_URL}/${activityId}`;
}

function uploadUrl(session: WorkoutSession): string {
  const params = new URLSearchParams({
    name: session.routeName,
    description: `Rowed in VirtualRow on ${session.routeName}.`,
    external_id: externalId(session),
  });
  return `${PROXY_BASE}${ACTIVITIES_PATH}?${params.toString()}`;
}

/** Read the activity id and any message out of a response body, whatever its shape. */
async function readBody(response: Response): Promise<{ id: string; message: string }> {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as RawActivityResponse | RawActivityResponse[];
    const activity = Array.isArray(parsed) ? parsed[0] : parsed;
    return {
      id: activity?.id === undefined ? '' : String(activity.id),
      message: activity?.error ?? activity?.message ?? text,
    };
  } catch {
    return { id: '', message: text };
  }
}

export class IntervalsIcuActivityService {
  /**
   * Activity ids for sessions already uploaded in this browser session, so a
   * second click cannot create a second activity (AC3.3). The durable record
   * is the local workout store, which keeps the same id across a reload.
   */
  private uploadedActivityIds = new Map<string, string>();

  /**
   * Upload `fileBytes` as the activity for `session`.
   *
   * Never throws: every failure is reported as a result the summary can show.
   * Nothing is recorded as uploaded unless intervals.icu accepted it, so a
   * failed attempt stays retryable and the retry rebuilds the file from the
   * session rather than resending a partial body (AC3.6).
   */
  async uploadActivity(
    session: WorkoutSession,
    fileBytes: Uint8Array,
    auth: ActivityUploadAuth,
  ): Promise<ActivityUploadResult> {
    if (session.isGuest) {
      return { status: 'failed', message: 'Guest rows are not uploaded to intervals.icu.' };
    }

    const alreadyUploaded = this.uploadedActivityIds.get(session.id);
    if (alreadyUploaded !== undefined) {
      return { status: 'already-uploaded', activityId: alreadyUploaded, activityUrl: activityUrl(alreadyUploaded) };
    }

    const token = auth.getAccessToken();
    if (!token) return { status: 'auth-expired', message: EXPIRED_MESSAGE };

    const first = await this.post(session, fileBytes, token);
    if (first.kind === 'unauthorized') {
      const refreshed = await auth.refreshAccessToken();
      const retryToken = refreshed ? auth.getAccessToken() : null;
      if (!retryToken) return { status: 'auth-expired', message: EXPIRED_MESSAGE };

      const second = await this.post(session, fileBytes, retryToken);
      if (second.kind === 'unauthorized') return { status: 'auth-expired', message: EXPIRED_MESSAGE };
      return this.settle(session, second);
    }

    return this.settle(session, first);
  }

  private settle(
    session: WorkoutSession,
    attempt: Exclude<UploadAttempt, { kind: 'unauthorized' }>,
  ): ActivityUploadResult {
    if (attempt.kind === 'failed') return { status: 'failed', message: attempt.message };

    this.uploadedActivityIds.set(session.id, attempt.activityId);
    return {
      status: attempt.kind === 'duplicate' ? 'already-uploaded' : 'uploaded',
      activityId: attempt.activityId,
      activityUrl: activityUrl(attempt.activityId),
    };
  }

  private async post(
    session: WorkoutSession,
    fileBytes: Uint8Array,
    token: string,
  ): Promise<UploadAttempt> {
    const filename = activityFileName(session);
    const form = new FormData();
    const blob = new Blob([fileBytes as BlobPart], { type: 'application/octet-stream' });
    form.append('file', blob, filename);

    let response: Response;
    try {
      response = await fetch(uploadUrl(session), {
        method: 'POST',
        // No Content-Type: the browser must set it so the multipart boundary
        // matches the body it generated.
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { kind: 'failed', message: `Could not reach intervals.icu: ${reason}` };
    }

    if (response.status === 401) return { kind: 'unauthorized' };

    const { id, message } = await readBody(response);
    if (response.ok) return { kind: 'uploaded', activityId: id };
    // intervals.icu rejects a repeat external_id rather than duplicating the row.
    if (/duplicate|already exists/i.test(message)) return { kind: 'duplicate', activityId: id };

    return {
      kind: 'failed',
      message: `intervals.icu rejected the upload (${response.status})${message ? `: ${message}` : ''}`,
    };
  }
}

/** One round-trip to the endpoint, before the caller decides what it means. */
type UploadAttempt =
  | { kind: 'uploaded'; activityId: string }
  | { kind: 'duplicate'; activityId: string }
  | { kind: 'unauthorized' }
  | { kind: 'failed'; message: string };

export const intervalsIcuActivityService = new IntervalsIcuActivityService();
