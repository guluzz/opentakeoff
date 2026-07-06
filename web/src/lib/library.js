// Assembly library — a cross-project catalog of reusable condition "assemblies":
// a finish's tag, color, hatch, waste %, supporting materials, and unit pricing.
// Saved in localStorage so the same finishes carry into every project instead of
// being rebuilt each job. Pure transforms (def<->condition, list ops) are split
// from the storage layer so they're unit-testable.

const LS_LIBRARY = "opentakeoff_library";
const now = () => Date.now();
const newId = () => (globalThis.crypto?.randomUUID?.() || `lib_${now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`);

// The reusable slice of a condition — everything except its per-project identity,
// multiplier, and the shapes drawn against it. Material rows drop their ids.
export function defFromCondition(c) {
  return {
    finish_tag: c.finish_tag || "",
    color: c.color, fill: c.fill, hatch: c.hatch,
    waste_pct: Number(c.waste_pct) || 0,
    height_ft: c.height_ft || null,
    thickness_in: c.thickness_in || null,
    price_material: Number(c.price_material) || 0,
    price_labor: Number(c.price_labor) || 0,
    materials: (c.materials || []).map((m) => ({ name: m.name || "", per: Number(m.per) || 0, basis: m.basis || "area", unit: m.unit || "", note: m.note || "", round: m.round !== false })),
  };
}

// A fresh project condition built from a library def. `mkId(prefix)` mints unique
// ids (pass the app's uid) so the new condition and its materials don't collide.
export function conditionFromDef(def, mkId) {
  return {
    id: mkId("cnd"),
    finish_tag: def.finish_tag || "",
    color: def.color, fill: def.fill, hatch: def.hatch,
    multiplier: 1, waste_pct: Number(def.waste_pct) || 0,
    ...(def.height_ft ? { height_ft: def.height_ft } : {}),
    ...(def.thickness_in ? { thickness_in: def.thickness_in } : {}),
    price_material: Number(def.price_material) || 0,
    price_labor: Number(def.price_labor) || 0,
    materials: (def.materials || []).map((m) => ({ id: mkId("mat"), round: m.round !== false, name: m.name || "", per: Number(m.per) || 0, basis: m.basis || "area", unit: m.unit || "", note: m.note || "" })),
  };
}

// newest-first; replace by id or prepend
export function upsertEntry(list, entry) {
  const i = list.findIndex((e) => e.id === entry.id);
  if (i < 0) return [entry, ...list];
  const next = list.slice(); next[i] = entry; return next;
}
export function removeEntry(list, id) { return list.filter((e) => e.id !== id); }

// ── localStorage layer ───────────────────────────────────────────────────────
export function loadLibrary() {
  try { const v = JSON.parse(localStorage.getItem(LS_LIBRARY)); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function persist(list) { try { localStorage.setItem(LS_LIBRARY, JSON.stringify(list)); } catch { /* private mode */ } }

export function saveConditionToLibrary(condition, name) {
  const entry = { id: newId(), name: ((name || condition.finish_tag || "Untitled").trim()) || "Untitled", savedAt: now(), def: defFromCondition(condition) };
  const list = upsertEntry(loadLibrary(), entry);
  persist(list);
  return { entry, list };
}
export function deleteLibraryEntry(id) { const list = removeEntry(loadLibrary(), id); persist(list); return list; }
