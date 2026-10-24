<!--
  GhostPicker (#338, ported to Svelte for #542 P1). What to race, decided before
  the row starts. Presentational: it takes the current choice and reports changes
  up, exactly like the React component. DOM, class names and copy are kept
  verbatim so the Playwright selectors keep resolving.
-->
<script lang="ts">
  import { formatSplit } from '../utils/formatters';
  import { parsePaceInput, DEFAULT_TARGET_PACE } from '../utils/paceInput';
  import type { GhostChoice } from './ghostChoice';
  import './GhostPicker.css';

  interface Props {
    value: GhostChoice;
    onChange: (choice: GhostChoice) => void;
    /** Whether this browser kept a row on this route that can be raced. */
    hasBest: boolean;
    /** That row's average split, for the label. */
    bestPace: number | null;
  }

  let { value, onChange, hasBest, bestPace }: Props = $props();

  // What the rower has typed, which is not the same as the pace being raced:
  // the field holds `2:` for a keystroke, and the boat does not.
  // svelte-ignore state_referenced_locally
  let paceText = $state(
    formatSplit(value.kind === 'pace' ? value.paceSPer500 : DEFAULT_TARGET_PACE),
  );

  function pick(kind: GhostChoice['kind']) {
    onChange(
      kind === 'pace'
        ? { kind: 'pace', paceSPer500: parsePaceInput(paceText) ?? DEFAULT_TARGET_PACE }
        : ({ kind } as GhostChoice),
    );
  }

  function onPaceInput(event: Event) {
    const next = (event.currentTarget as HTMLInputElement).value;
    paceText = next;
    const parsed = parsePaceInput(next);
    if (parsed !== null) onChange({ kind: 'pace', paceSPer500: parsed });
  }
</script>

<fieldset class="ghost-picker">
  <legend class="ghost-picker-legend">Row against</legend>

  <label class="ghost-picker-option">
    <input type="radio" name="ghost" checked={value.kind === 'none'} onchange={() => pick('none')} />
    <span>Row alone</span>
  </label>

  <label class="ghost-picker-option">
    <input
      type="radio"
      name="ghost"
      checked={value.kind === 'best'}
      disabled={!hasBest}
      onchange={() => pick('best')}
    />
    <span>
      Race my best
      {#if hasBest && bestPace !== null}
        <span class="ghost-picker-detail"> ({formatSplit(bestPace)}/500m)</span>
      {/if}
    </span>
  </label>
  <!--
    Disabled with the reason beside it rather than hidden: an option that
    vanishes looks like a feature that is not there, and the rower has done
    nothing wrong — they have simply not rowed here before.
  -->
  {#if !hasBest}
    <p class="ghost-picker-hint">
      Your first row on this route — there is nothing to race yet.
    </p>
  {/if}

  <label class="ghost-picker-option">
    <input type="radio" name="ghost" checked={value.kind === 'pace'} onchange={() => pick('pace')} />
    <span>Pace boat</span>
  </label>

  {#if value.kind === 'pace'}
    <label class="ghost-picker-pace">
      <span>Target pace</span>
      <input
        type="text"
        inputmode="numeric"
        class="ghost-picker-pace-field"
        value={paceText}
        placeholder="2:00"
        oninput={onPaceInput}
      />
      <span class="ghost-picker-detail">/500m</span>
    </label>
  {/if}
</fieldset>
