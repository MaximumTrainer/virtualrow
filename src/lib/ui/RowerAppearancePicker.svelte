<!--
  RowerAppearancePicker (#474, ported to Svelte for #542 P1). Lets a rower pick
  clothing, hair, hairstyle, hat and hat colour, inside a `<details>` disclosure
  so the pre-row panel stays compact. The hat-colour row is hidden when the hat
  slot is 'none'. DOM, class names, data-testids and copy are kept verbatim so
  the Playwright selectors keep resolving.
-->
<script lang="ts">
  import {
    TOP_PALETTE,
    SHORTS_PALETTE,
    SHOES_PALETTE,
    HAIR_PALETTE,
    HAT_PALETTE,
    HAIRSTYLE_OPTIONS,
    HAT_OPTIONS,
    type PaletteOption,
    type HairstyleId,
    type HatId,
  } from '../../components/rower3d/rowerAppearance';
  import type { RowerAppearancePreference } from '../services/rowerAppearanceService';
  import './RowerAppearancePicker.css';

  interface Props {
    appearance: RowerAppearancePreference;
    onChange: <K extends keyof RowerAppearancePreference>(
      slot: K,
      value: RowerAppearancePreference[K],
    ) => void;
  }

  let { appearance, onChange }: Props = $props();
</script>

{#snippet swatchRow(
  label: string,
  palette: readonly PaletteOption[],
  selected: string,
  onPick: (id: string) => void,
)}
  <div class="rower-appearance-row">
    <span class="rower-appearance-label">{label}</span>
    <div class="rower-appearance-swatches" role="radiogroup" aria-label={label}>
      {#each palette as option (option.id)}
        <button
          type="button"
          role="radio"
          aria-checked={selected === option.id}
          aria-label={option.label}
          title={option.label}
          class="rower-appearance-swatch{selected === option.id ? ' is-selected' : ''}"
          style="background-color: {option.hex};"
          onclick={() => onPick(option.id)}
        ></button>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet textRow(
  label: string,
  options: readonly { readonly id: string; readonly label: string }[],
  selected: string,
  onPick: (id: string) => void,
)}
  <div class="rower-appearance-row">
    <span class="rower-appearance-label">{label}</span>
    <div class="rower-appearance-chips" role="radiogroup" aria-label={label}>
      {#each options as option (option.id)}
        <button
          type="button"
          role="radio"
          aria-checked={selected === option.id}
          aria-label={option.label}
          title={option.label}
          class="rower-appearance-chip{selected === option.id ? ' is-selected' : ''}"
          onclick={() => onPick(option.id)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </div>
{/snippet}

<details class="rower-appearance" data-testid="rower-appearance">
  <summary class="rower-appearance-summary">Rower appearance</summary>
  <div class="rower-appearance-rows">
    {@render swatchRow('Top', TOP_PALETTE, appearance.top, (id) => onChange('top', id))}
    {@render swatchRow('Shorts', SHORTS_PALETTE, appearance.shorts, (id) => onChange('shorts', id))}
    {@render swatchRow('Shoes', SHOES_PALETTE, appearance.shoes, (id) => onChange('shoes', id))}
    {@render swatchRow('Hair', HAIR_PALETTE, appearance.hair, (id) => onChange('hair', id))}
    {@render textRow(
      'Hairstyle',
      HAIRSTYLE_OPTIONS,
      appearance.hairstyle,
      (id) => onChange('hairstyle', id as HairstyleId),
    )}
    {@render textRow('Hat', HAT_OPTIONS, appearance.hat, (id) => onChange('hat', id as HatId))}
    {#if appearance.hat !== 'none'}
      {@render swatchRow(
        'Hat colour',
        HAT_PALETTE,
        appearance.hatColor,
        (id) => onChange('hatColor', id),
      )}
    {/if}
  </div>
</details>
