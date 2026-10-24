<!--
  AuthButton — sign in / user menu (#542 P1, F4). Port of the React
  AuthButton.tsx: same DOM, class names, aria attributes and copy, so the auth
  Playwright specs keep passing. Reads auth state from the Svelte auth context;
  the CSS file is imported verbatim and stays global.
-->
<script lang="ts">
  import { getAuth } from './authContext';
  import { RETRYABLE_AUTH_ERROR_CLASSES } from '../services/authService';
  import './AuthButton.css';

  const auth = getAuth();

  let dropdownOpen = $state(false);
  let loginError = $state<string | null>(null);

  const visibleError = $derived(loginError ?? auth.authError);
  // `config` is the only class that is NOT recoverable from a retry; every
  // other class (including the fallback `unknown` and the `null` from a
  // locally-thrown login error) offers the button (#486 Phase 2 FR3, D4 = a).
  const showRetryButton = $derived(
    visibleError !== null &&
      (auth.authErrorClass === null || RETRYABLE_AUTH_ERROR_CLASSES.has(auth.authErrorClass)),
  );

  function startLogin() {
    loginError = null;
    auth.clearAuthError();
    auth.login().catch((err: unknown) => {
      loginError = err instanceof Error ? err.message : 'Login failed';
    });
  }
</script>

{#if auth.isLoading}
  <div class="auth-button auth-button--loading" aria-busy="true">
    <span class="auth-spinner" aria-hidden="true"></span>
    <span>Signing in…</span>
  </div>
{:else if !auth.isAuthenticated || !auth.user}
  <div class="auth-signin-wrapper">
    <button
      type="button"
      class="auth-button auth-button--signin"
      onclick={startLogin}
      aria-label="Sign in with intervals.icu"
    >
      <span class="auth-icu-icon" aria-hidden="true">🔑</span>
      <!-- The full label does not fit beside the title and the hamburger on a
           320px header. The accessible name comes from aria-label above, so it
           stays the same at every width (issue #219, R8). -->
      <span class="auth-button-text auth-button-text--long">Sign in with intervals.icu</span>
      <span class="auth-button-text auth-button-text--short">Sign in</span>
    </button>
    {#if visibleError}
      <div
        class="auth-login-error"
        role="alert"
        title={visibleError}
        data-auth-error-class={auth.authErrorClass ?? 'unknown'}
      >
        ⚠️ {visibleError.includes('VITE_INTERVALS_CLIENT_ID')
          ? 'OAuth client ID not configured — check DEVELOPMENT.md'
          : visibleError}
        {#if showRetryButton}
          <button type="button" class="auth-retry-button" onclick={startLogin}>
            Retry sign in
          </button>
        {/if}
      </div>
    {/if}
  </div>
{:else}
  {@const user = auth.user}
  <div class="auth-user-menu">
    <button
      type="button"
      class="auth-user-trigger"
      onclick={() => (dropdownOpen = !dropdownOpen)}
      aria-haspopup="true"
      aria-expanded={dropdownOpen}
      aria-label={`Account menu for ${user.name}`}
    >
      {#if user.avatarUrl}
        <img src={user.avatarUrl} alt={user.name} class="auth-avatar" width="28" height="28" />
      {:else}
        <span class="auth-avatar-placeholder" aria-hidden="true">
          {user.name.charAt(0).toUpperCase()}
        </span>
      {/if}
      <span class="auth-display-name">{user.name}</span>
      <span class="auth-caret" aria-hidden="true">▾</span>
    </button>

    {#if dropdownOpen}
      <!-- Backdrop to close the dropdown when clicking outside -->
      <div
        class="auth-dropdown-backdrop"
        onclick={() => (dropdownOpen = false)}
        aria-hidden="true"
      ></div>
      <div class="auth-dropdown" role="menu">
        <div class="auth-dropdown-header">
          <span class="auth-dropdown-name">{user.name}</span>
          <span class="auth-dropdown-email">{user.email}</span>
        </div>
        <hr class="auth-dropdown-divider" />
        <button
          type="button"
          role="menuitem"
          class="auth-dropdown-item auth-dropdown-item--signout"
          onclick={() => {
            dropdownOpen = false;
            auth.logout();
          }}
        >
          ↩ Sign Out
        </button>
      </div>
    {/if}
  </div>
{/if}
