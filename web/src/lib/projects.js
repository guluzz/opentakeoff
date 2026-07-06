// Projects registry — pure list operations behind the multi-project store. No
// storage or DOM here, so the fiddly bits (upsert, rename, "which project takes
// over after I delete the active one") are unit-testable in isolation. store.js
// owns the localStorage persistence and the per-project IndexedDB databases.

// The pre-multiproject workspace keeps its original database name and becomes the
// user's first project under this id (so migration copies nothing).
export const DEFAULT_PROJECT_ID = "default";

export function makeProject(id, name, now) {
  return { id, name: (name || "").trim(), createdAt: now, updatedAt: now };
}

// Replace the entry with proj.id, or append it. Never duplicates an id.
export function upsertProject(list, proj) {
  const i = list.findIndex((p) => p.id === proj.id);
  if (i < 0) return [...list, proj];
  const next = list.slice();
  next[i] = { ...next[i], ...proj };
  return next;
}

export function renameInList(list, id, name, now) {
  return list.map((p) => (p.id === id ? { ...p, name: (name || "").trim(), updatedAt: now } : p));
}

export function touchInList(list, id, now) {
  return list.map((p) => (p.id === id ? { ...p, updatedAt: now } : p));
}

export function removeFromList(list, id) {
  return list.filter((p) => p.id !== id);
}

// After a delete, the active project should fall to the most-recently-updated of
// whatever remains (null if nothing's left — caller then seeds a fresh default).
// `list` is the registry AFTER removal.
export function nextActiveId(list) {
  if (!list.length) return null;
  return list.reduce((best, p) => (p.updatedAt > best.updatedAt ? p : best)).id;
}

// What the UI shows for a project (never blank).
export function displayName(proj) {
  return ((proj && proj.name) || "").trim() || "Untitled project";
}
