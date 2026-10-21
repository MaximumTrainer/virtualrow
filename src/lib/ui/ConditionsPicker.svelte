<!--
  ConditionsPicker (#346, ported to Svelte for #542 P1). The light a row is
  rowed in, set once beside the graphics tier. Buttons with role="radio" rather
  than real radio inputs, matching GraphicsQualityPicker. DOM, class names and
  copy are kept verbatim so the Playwright selectors keep resolving.
-->
<script lang="ts">
  import { CONDITIONS, conditionsLabel, type Conditions } from '../../components/rower3d/conditions';
  import type { ConditionsChoice } from './useConditions.svelte';

  interface Props {
    choice: ConditionsChoice;
    /** What `auto` resolved to, so the panel can say what the clock decided. */
    resolved: Conditions;
    onChange: (choice: ConditionsChoice) => void;
  }

  let { choice, resolved, onChange }: Props = $props();
</script>

<fieldset class="conditions-picker">
  <legend class="conditions-picker-legend">Conditions</legend>
  <div class="conditions-picker-options" role="radiogroup" aria-label="Conditions">
    <button
      type="button"
      role="radio"
      aria-checked={choice === 'auto'}
      title="Light the scene for the time of day it is"
      class="conditions-picker-option{choice === 'auto' ? ' is-selected' : ''}"
      onclick={() => onChange('auto')}
    >
      My clock
      <!--
        Most rowers never change this, which makes what it *resolved to* the
        thing worth saying: otherwise the panel reports that the setting is
        automatic and never says what automatic decided.
      -->
      {#if choice === 'auto'}
        <span class="conditions-picker-resolved"> ({conditionsLabel(resolved)})</span>
      {/if}
    </button>

    {#each CONDITIONS as condition (condition)}
      <button
        type="button"
        role="radio"
        aria-checked={choice === condition}
        class="conditions-picker-option{choice === condition ? ' is-selected' : ''}"
        onclick={() => onChange(condition)}
      >
        {conditionsLabel(condition)}
      </button>
    {/each}
  </div>
</fieldset>
