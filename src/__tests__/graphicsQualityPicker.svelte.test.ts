import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import GraphicsQualityPicker from '../lib/ui/GraphicsQualityPicker.svelte';

/**
 * Ported from the React graphicsQualityPicker test for #542 P1. DOM, roles,
 * titles and copy are verbatim, so the assertions carry over unchanged.
 */
describe('GraphicsQualityPicker', () => {
  it('offers the tiers as a labelled radio group', () => {
    render(GraphicsQualityPicker, { quality: 'auto', onChange: vi.fn() });
    const group = screen.getByRole('radiogroup', { name: /graphics quality/i });
    expect(group).toBeTruthy();
    // #455 FR6: six options — auto plus the five tiers.
    expect(screen.getAllByRole('radio')).toHaveLength(6);
  });

  it('marks the current choice as checked, and only that one', () => {
    render(GraphicsQualityPicker, { quality: 'basic', onChange: vi.fn() });
    expect(screen.getByRole('radio', { name: 'Basic' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Auto' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: 'Extra High' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('reports the tier the rower picked', async () => {
    const onChange = vi.fn();
    render(GraphicsQualityPicker, { quality: 'auto', onChange });
    await fireEvent.click(screen.getByRole('radio', { name: 'Extra High' }));
    expect(onChange).toHaveBeenCalledWith('extra-high');
  });

  it('explains what each tier does', () => {
    render(GraphicsQualityPicker, { quality: 'auto', onChange: vi.fn() });
    expect(screen.getByRole('radio', { name: 'Auto' }).getAttribute('title')).toBe(
      'Match the graphics card',
    );
    expect(screen.getByRole('radio', { name: 'Basic' }).getAttribute('title')).toBe(
      'No shadows or effects',
    );
  });
});
