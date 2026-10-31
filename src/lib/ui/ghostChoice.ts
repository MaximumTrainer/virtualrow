/**
 * What to race on a row (#338). Lives in its own module (not the component)
 * so both the picker and the cross-view session state can import the type
 * under plain `tsc`, which does not read a Svelte `<script module>` export.
 */
export type GhostChoice =
  | { kind: 'none' }
  | { kind: 'best' }
  | { kind: 'pace'; paceSPer500: number };
