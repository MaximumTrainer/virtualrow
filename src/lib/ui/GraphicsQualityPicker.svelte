<!--
  GraphicsQualityPicker (#455 FR5, ported to Svelte for #542 P1). Lets a rower
  overrule the engine's guess about their graphics card (#224 4G). DOM, class
  names, roles, titles and copy kept verbatim vs the React component so the
  Playwright selectors keep resolving.
-->
<script lang="ts">
  import { GRAPHICS_QUALITY_OPTIONS, type GraphicsQuality } from './graphicsQuality.svelte';
  import './GraphicsQualityPicker.css';

  interface Props {
    quality: GraphicsQuality;
    onChange: (quality: GraphicsQuality) => void;
  }

  let { quality, onChange }: Props = $props();
</script>

<fieldset class="graphics-quality">
  <legend class="graphics-quality-legend">Graphics</legend>
  <div class="graphics-quality-options" role="radiogroup" aria-label="Graphics quality">
    {#each GRAPHICS_QUALITY_OPTIONS as option (option.value)}
      <button
        type="button"
        role="radio"
        aria-checked={quality === option.value}
        title={option.hint}
        class="graphics-quality-option{quality === option.value ? ' is-selected' : ''}"
        onclick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    {/each}
  </div>
</fieldset>
