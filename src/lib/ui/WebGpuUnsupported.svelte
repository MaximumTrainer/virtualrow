<!--
  #542 FR11 / AC11 (D11-a/c): the "needs WebGPU" screen the ride view falls
  back to when the engine's `attach` declines (no `navigator.gpu`, software
  adapter only, or an attach throw). Only the ride needs WebGPU; the rest of
  the site (routes, settings, summary, import) keeps working from this
  screen's "Back to routes" link.

  Copy and markup are deliberately plain so no visual baseline is wired up to
  it yet; the baseline work waits for the GPU runner (D5-b).
-->
<script lang="ts">
  /**
   * `backHref` is the path back to the Routes landing. The ride page passes
   * SvelteKit's `base + '/'` so the link honours the deploy sub-path; the
   * default keeps the component unit-testable without `$app/paths`.
   */
  interface Props {
    backHref?: string;
  }
  let { backHref = '/' }: Props = $props();
</script>

<section class="webgpu-unsupported" role="alert">
  <h1>WebGPU is required to row</h1>
  <p>
    This simulator renders the river in a WebGPU graphics engine. Your browser
    either does not expose <code>navigator.gpu</code> or only has a software
    adapter, so the ride view cannot start.
  </p>
  <p>
    Open the app in a recent build of Chrome, Chromium, Edge, Safari or
    Firefox with hardware WebGPU enabled, then come back.
  </p>
  <p class="webgpu-unsupported__actions">
    <a class="webgpu-unsupported__link" href={backHref}>Back to routes</a>
  </p>
</section>

<style>
  .webgpu-unsupported {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 42rem;
    margin: 2rem auto;
    padding: 1.5rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.35);
    color: #f5f5f5;
    font: inherit;
  }
  .webgpu-unsupported h1 {
    margin: 0;
    font-size: 1.5rem;
  }
  .webgpu-unsupported__link {
    display: inline-block;
    padding: 0.5rem 1rem;
    border-radius: 999px;
    background: #2f6feb;
    color: #fff;
    text-decoration: none;
    font-weight: 600;
  }
  .webgpu-unsupported__link:hover,
  .webgpu-unsupported__link:focus {
    background: #4c88ff;
  }
</style>
