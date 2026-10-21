<!--
  SettingsPanel (issue #473, ported to Svelte for #542 P1). The Settings
  surface reached from the header gear button. Phase 1 ships one section —
  Diagnostics — with the crash-reports opt-out (default on, D3=b) and an
  expandable "What's in a report?" listing the FR4 fields and FR6 redaction.
  Subscribes to the preference store so an external toggle updates live (AC8).
  DOM, class names, ids and copy kept verbatim vs the React component so the
  Playwright settings selectors keep resolving.
-->
<script lang="ts">
  import type { CrashReportsPreferencePort } from '../ports';
  import { crashReportsPreferenceStore as defaultStore } from '../services/crashReportsPreferenceStore';
  import './SettingsPanel.css';

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    /** The preference store; defaults to the production singleton. */
    crashReportsPreferenceStore?: CrashReportsPreferencePort;
    /**
     * The signed-in intervals.icu athlete id, when there is one. Passed
     * through so the "What's in a report?" list can tell the rower whether
     * their athlete id is attached (D2=b), without the panel knowing auth.
     */
    intervalsIcuAthleteId: string | null;
  }

  let {
    isOpen,
    onClose,
    crashReportsPreferenceStore = defaultStore,
    intervalsIcuAthleteId,
  }: Props = $props();

  const DIAGNOSTICS_LIST_ID = 'settings-diagnostics-explain';

  // svelte-ignore state_referenced_locally
  let enabled = $state(crashReportsPreferenceStore.isEnabled());
  let whatsInExpanded = $state(false);

  // Keep the UI in step with external writes (AC8).
  $effect(() => crashReportsPreferenceStore.subscribe((next) => (enabled = next)));

  function handleToggle(next: boolean) {
    enabled = next;
    crashReportsPreferenceStore.setEnabled(next);
  }
</script>

{#if isOpen}
  <div class="settings-panel-backdrop" role="presentation" onclick={onClose}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <aside
      class="settings-panel"
      role="dialog"
      aria-labelledby="settings-panel-title"
      aria-modal="true"
      onclick={(e) => e.stopPropagation()}
    >
      <header class="settings-panel-header">
        <h2 id="settings-panel-title">Settings</h2>
        <button type="button" class="settings-close-btn" onclick={onClose} aria-label="Close settings">
          ✕
        </button>
      </header>

      <section class="settings-section" aria-labelledby="settings-diagnostics-title">
        <h3 id="settings-diagnostics-title">Diagnostics</h3>
        <label class="settings-toggle-row">
          <input
            type="checkbox"
            checked={enabled}
            onchange={(e) => handleToggle(e.currentTarget.checked)}
          />
          <span class="settings-toggle-label">Send crash reports to help us fix bugs</span>
        </label>
        <p class="settings-helper">
          When VirtualRow crashes, a one-time anonymous report is sent to the
          maintainers so the bug can be found and fixed.
        </p>
        <button
          type="button"
          class="settings-explain-toggle"
          aria-expanded={whatsInExpanded}
          aria-controls={DIAGNOSTICS_LIST_ID}
          onclick={() => (whatsInExpanded = !whatsInExpanded)}
        >
          {whatsInExpanded ? 'Hide' : "What's in a report?"}
        </button>
        {#if whatsInExpanded}
          <ul id={DIAGNOSTICS_LIST_ID} class="settings-explain-list">
            <li>An opaque browser-profile id (not your name, not your email).</li>
            <li>The deploy's build SHA so we can map the crash to code.</li>
            <li>Your browser, viewport size and graphics tier.</li>
            <li>A short error summary (message + first stack frame).</li>
            <li>The last few minutes of scene telemetry (frames, context events).</li>
            {#if intervalsIcuAthleteId}
              <li>
                Your intervals.icu athlete id ({intervalsIcuAthleteId}) — a number only,
                no name, no token.
              </li>
            {:else}
              <li>No account identifier (you are not signed in).</li>
            {/if}
            <li>
              Tokens, email addresses and coordinates are stripped before the
              report leaves your browser.
            </li>
          </ul>
        {/if}
      </section>
    </aside>
  </div>
{/if}
