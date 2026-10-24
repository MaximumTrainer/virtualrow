<!--
  Test fixture (#542 session-summary slice): provides the auth and services
  context SessionSummary reads, then renders it with the given props. Mirrors
  the React suite's renderSummary wrapper (AuthContext.Provider +
  ServicesProvider). Lives under src/__tests__ (coverage-excluded).
-->
<script lang="ts">
  import { setAuth } from '../../lib/ui/authContext';
  import { setServices } from '../../lib/ui/servicesContext';
  import { AuthStore } from '../../lib/ui/auth.svelte';
  import SessionSummary from '../../lib/ui/SessionSummary.svelte';
  import type { AuthUser, GeometrySource, WorkoutSession } from '../../lib/types/index';
  import type { ActivityUploadResult } from '../../lib/services/intervalsIcuActivityService';

  interface Props {
    session: WorkoutSession;
    onDone: () => void;
    onSaved?: (activityId: string) => void;
    isDemo?: boolean;
    personalBest?: number | null;
    ghost?: { seconds: number | null; label: string } | null;
    routeGeometrySource?: GeometrySource;
    /** The signed-in athlete, or null for a signed-out tree. */
    authUser?: AuthUser | null;
    /** Stubbed uploadActivity the summary's Save button funnels through. */
    uploadActivity?: (...args: unknown[]) => Promise<ActivityUploadResult>;
  }

  let {
    session,
    onDone,
    onSaved,
    isDemo,
    personalBest,
    ghost,
    routeGeometrySource,
    authUser = { id: 'i123', name: 'Alex', email: 'alex@example.com' },
    uploadActivity,
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  const auth = new AuthStore();
  // svelte-ignore state_referenced_locally
  auth.user = authUser ?? null;
  setAuth(auth);

  // svelte-ignore state_referenced_locally
  if (uploadActivity) {
    setServices({
      intervalsIcuActivityService: { uploadActivity } as never,
    });
  } else {
    setServices();
  }
</script>

<SessionSummary {session} {onDone} {onSaved} {isDemo} {personalBest} {ghost} {routeGeometrySource} />
