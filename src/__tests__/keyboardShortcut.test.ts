import { describe, it, expect } from 'vitest';
import { isShortcutKey } from '../utils/keyboardShortcut';

const press = (init: KeyboardEventInit, target: EventTarget = window) => {
  let seen: KeyboardEvent | undefined;
  const listener = (e: Event) => {
    seen = e as KeyboardEvent;
  };
  window.addEventListener('keydown', listener);
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  window.removeEventListener('keydown', listener);
  return seen!;
};

describe('isShortcutKey', () => {
  it('matches the letter in either case', () => {
    expect(isShortcutKey(press({ key: 'f' }), 'f')).toBe(true);
    expect(isShortcutKey(press({ key: 'F', shiftKey: true }), 'f')).toBe(true);
    expect(isShortcutKey(press({ key: 'g' }), 'f')).toBe(false);
  });

  it('leaves the browser its own shortcuts', () => {
    expect(isShortcutKey(press({ key: 'f', ctrlKey: true }), 'f')).toBe(false);
    expect(isShortcutKey(press({ key: 'f', metaKey: true }), 'f')).toBe(false);
    expect(isShortcutKey(press({ key: 'f', altKey: true }), 'f')).toBe(false);
  });

  it('ignores a key typed into a field', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      const field = document.createElement(tag);
      document.body.appendChild(field);
      expect(isShortcutKey(press({ key: 'f' }, field), 'f')).toBe(false);
      field.remove();
    }
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.appendChild(editable);
    expect(isShortcutKey(press({ key: 'f' }, editable), 'f')).toBe(false);
    editable.remove();
  });
});
