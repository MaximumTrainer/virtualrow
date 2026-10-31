/**
 * PKCE (Proof Key for Code Exchange) and CSRF state helpers for OAuth 2.0.
 *
 * Implements RFC 7636 S256 challenge method.
 * All crypto operations use the Web Crypto API (SubtleCrypto).
 */

/** Length in bytes for the code verifier (results in ~86 base64url chars). */
const VERIFIER_BYTES = 64;
/** Length in bytes for the state parameter (CSRF protection). */
const STATE_BYTES = 16;

/**
 * Encode a Uint8Array as base64url (no padding, URL-safe).
 * RFC 4648 §5.
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate a cryptographically random PKCE code verifier.
 * RFC 7636 §4.1: 43–128 characters from [A-Z a-z 0-9 - . _ ~]
 */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(VERIFIER_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Derive the PKCE code challenge (S256) from a code verifier.
 * SHA-256(verifier) encoded as base64url.
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Generate a random state string for CSRF protection.
 * 16 bytes → ~22 base64url characters.
 */
export function generateState(): string {
  const bytes = new Uint8Array(STATE_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
