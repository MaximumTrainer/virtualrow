import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';

import Scaffold from '../lib/Scaffold.svelte';

// #542 P0 (AC3): proves the Svelte toolchain runs under Vitest —
// `@sveltejs/vite-plugin-svelte` compiles the component and
// `@testing-library/svelte` mounts it in jsdom.
describe('Scaffold.svelte', () => {
  it('renders the greeting with the given name', () => {
    render(Scaffold, { name: 'virtualrow' });
    expect(screen.getByText('Hello virtualrow')).toBeTruthy();
  });
});
