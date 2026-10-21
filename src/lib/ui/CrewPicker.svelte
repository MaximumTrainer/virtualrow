<!--
  CrewPicker (#232, ported to Svelte for #542 P1). Lets a rower choose who is in
  the boat; since #443 it only renders for guests, demo rows and signed-in
  athletes whose intervals.icu profile has no `sex` field. Reuses the
  `.graphics-quality` classes. DOM, class names and copy are kept verbatim so
  the Playwright selectors keep resolving.
-->
<script lang="ts">
  import { CREW_PREFERENCE_OPTIONS, type CrewPreference } from './useCrewPreference.svelte';

  interface Props {
    preference: CrewPreference;
    onChange: (preference: CrewPreference) => void;
  }

  let { preference, onChange }: Props = $props();
</script>

<fieldset class="graphics-quality">
  <legend class="graphics-quality-legend">Rower</legend>
  <div class="graphics-quality-options" role="radiogroup" aria-label="Rower appearance">
    {#each CREW_PREFERENCE_OPTIONS as option (option.value)}
      <button
        type="button"
        role="radio"
        aria-checked={preference === option.value}
        title={option.hint}
        class="graphics-quality-option{preference === option.value ? ' is-selected' : ''}"
        onclick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    {/each}
  </div>
</fieldset>
