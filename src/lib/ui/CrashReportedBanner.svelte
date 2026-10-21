<!--
  CrashReportedBanner (issue #473, FR9, ported to Svelte for #542 P1). The
  non-modal, dismissible "a report was sent last time" banner, shown top-right
  on the first load after a crash was reported. Hidden when the opt-out is off
  so a rower who turned reporting off never sees a disclosure about a report
  that would not have been sent. Class name, copy and inline styles kept
  verbatim vs the React component.
-->
<script lang="ts">
  import { crashBannerStore } from '../services/crashBannerStore';
  import { crashReportsPreferenceStore } from '../services/crashReportsPreferenceStore';

  interface Props {
    /** Fires when the viewer taps the opt-out link. The shell opens Settings. */
    onOpenSettings?: () => void;
  }

  let { onOpenSettings }: Props = $props();

  function initialVisible(): boolean {
    try {
      if (!crashReportsPreferenceStore.isEnabled()) return false;
      return crashBannerStore.current() !== null;
    } catch {
      return false;
    }
  }

  // svelte-ignore state_referenced_locally
  let visible = $state(initialVisible());

  // Opt-out may be toggled while the banner is up; mirror that live so a rower
  // who turns reporting off also loses the "a report was sent" disclosure.
  $effect(() => {
    try {
      return crashReportsPreferenceStore.subscribe((enabled) => {
        if (!enabled) visible = false;
      });
    } catch {
      return undefined;
    }
  });

  function handleDismiss() {
    try {
      crashBannerStore.dismiss();
    } catch {
      // ignored
    }
    visible = false;
  }
</script>

{#if visible}
  <div
    role="status"
    aria-live="polite"
    class="crash-reported-banner"
    style="position:fixed;top:12px;right:12px;z-index:1500;max-width:calc(100vw - 24px);display:flex;align-items:center;gap:12px;padding:8px 12px;background:rgba(26, 26, 46, 0.95);color:#e0e0e0;border:1px solid rgba(224, 224, 224, 0.2);border-radius:6px;font-size:13px;line-height:18px;box-shadow:0 2px 10px rgba(0, 0, 0, 0.3);pointer-events:auto;"
  >
    <span>
      The previous session crashed. A diagnostic report was sent to help us
      fix it.
      {#if onOpenSettings}
        <button
          type="button"
          onclick={onOpenSettings}
          style="background:none;border:none;padding:0;color:#8bbcff;cursor:pointer;text-decoration:underline;font:inherit;"
        >
          Opt out
        </button>
      {/if}
    </span>
    <button
      type="button"
      aria-label="Dismiss"
      onclick={handleDismiss}
      style="margin-left:auto;background:none;border:none;color:#a0a0a0;cursor:pointer;font:inherit;font-size:18px;padding:0 4px;line-height:18px;"
    >
      ×
    </button>
  </div>
{/if}
