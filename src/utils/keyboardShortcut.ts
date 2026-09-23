/**
 * Is this key press a single-letter shortcut for `key`?
 *
 * Not while someone is typing - the shortcuts are single letters, and a route
 * name with a V or an F in it should not move the camera or fill the screen -
 * and not with a modifier held, which is the browser's or the system's
 * (Ctrl+F and Cmd+F are find). Shift is allowed, so caps lock does not matter.
 */
export function isShortcutKey(event: KeyboardEvent, key: string): boolean {
  if (event.key.toLowerCase() !== key.toLowerCase()) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const target = event.target as HTMLElement | null;
  return !(
    target?.isContentEditable ||
    target?.tagName === 'INPUT' ||
    target?.tagName === 'TEXTAREA' ||
    target?.tagName === 'SELECT'
  );
}
