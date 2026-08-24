// Global counter of currently-open editing dialogs. While > 0, background
// refetches are deferred so nothing re-renders under the user's cursor.
let openEditors = 0;
const listeners = new Set<() => void>();

export function enterEditor() { openEditors++; }
export function exitEditor() {
  openEditors = Math.max(0, openEditors - 1);
  if (openEditors === 0) listeners.forEach((fn) => fn());
}
export function isEditing() { return openEditors > 0; }
export function onEditorsClosed(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
