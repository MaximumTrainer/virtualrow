<!--
  SoundPicker (#339, ported to Svelte for #542 P1). Switching the sound on and
  setting how loud it is. The switch is the gesture a browser needs before it
  will start an AudioContext, which is why there is a switch at all. DOM, class
  names and copy are kept verbatim so the Playwright selectors keep resolving.
-->
<script lang="ts">
  import './SoundPicker.css';

  interface Props {
    enabled: boolean;
    /** 0..1. */
    volume: number;
    onToggle: (enabled: boolean) => void;
    onVolume: (volume: number) => void;
  }

  let { enabled, volume, onToggle, onVolume }: Props = $props();

  const percent = (v: number) => `${Math.round(v * 100)}%`;
</script>

<fieldset class="sound-picker">
  <legend class="sound-picker-legend">Sound</legend>

  <label class="sound-picker-switch">
    <input
      type="checkbox"
      role="switch"
      checked={enabled}
      aria-label="Sound"
      onchange={(event) => onToggle((event.currentTarget as HTMLInputElement).checked)}
    />
    <span>{enabled ? 'On' : 'Off'}</span>
  </label>

  <!-- A volume for sound that is off is a control with nothing to do. -->
  {#if enabled}
    <label class="sound-picker-volume">
      <span class="sound-picker-volume-label">Volume</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={volume}
        aria-label="Volume"
        aria-valuetext={percent(volume)}
        oninput={(event) => onVolume(Number((event.currentTarget as HTMLInputElement).value))}
      />
      <span class="sound-picker-volume-value">{percent(volume)}</span>
    </label>
  {/if}
</fieldset>
