import { test } from "node:test";
import assert from "node:assert/strict";
import { defFromCondition, conditionFromDef, upsertEntry, removeEntry } from "../src/lib/library.js";

// a project condition, incl. runtime-only fields the library must NOT carry
const condition = {
  id: "cnd-123", finish_tag: "LVT-1", color: "#b8860b", fill: "#b8860b", hatch: "plank",
  multiplier: 3, waste_pct: 8, price_material: 2.5, price_labor: 3,
  materials: [{ id: "mat-1", name: "Adhesive", per: 250, basis: "area", unit: "gal", round: true }],
};

test("defFromCondition: keeps the reusable finish, drops id/multiplier and material ids", () => {
  const def = defFromCondition(condition);
  assert.equal(def.finish_tag, "LVT-1");
  assert.equal(def.waste_pct, 8);
  assert.equal(def.price_material, 2.5);
  assert.equal(def.price_labor, 3);
  assert.equal((def as any).id, undefined);          // no project identity
  assert.equal((def as any).multiplier, undefined);  // multiplier is per-use
  assert.equal(def.materials[0].name, "Adhesive");
  assert.equal((def.materials[0] as any).id, undefined);  // material ids regenerated on use
});

test("conditionFromDef: mints fresh ids and resets multiplier to 1", () => {
  let n = 0;
  const mkId = (p: string) => `${p}-${n++}`;
  const c = conditionFromDef(defFromCondition(condition), mkId);
  assert.equal(c.id, "cnd-0");
  assert.equal(c.multiplier, 1);
  assert.equal(c.finish_tag, "LVT-1");
  assert.equal(c.waste_pct, 8);
  assert.equal(c.price_material, 2.5);
  assert.equal(c.materials[0].id, "mat-1");   // second mkId call
  assert.equal(c.materials[0].name, "Adhesive");
  assert.notEqual(c.id, condition.id);        // not the original condition's id
});

test("round-trips a finish without mutating the original condition", () => {
  const before = JSON.stringify(condition);
  const c = conditionFromDef(defFromCondition(condition), (p: string) => `${p}-x`);
  c.finish_tag = "CHANGED"; c.materials[0].name = "CHANGED";
  assert.equal(JSON.stringify(condition), before);   // original untouched
});

test("upsertEntry: prepends new (newest-first), replaces by id", () => {
  const a = { id: "a", name: "A", savedAt: 1, def: {} };
  const b = { id: "b", name: "B", savedAt: 2, def: {} };
  let list = upsertEntry([a], b);
  assert.deepEqual(list.map((e: any) => e.id), ["b", "a"]);   // newest first
  list = upsertEntry(list, { ...a, name: "A2" });
  assert.equal(list.length, 2);
  assert.equal(list.find((e: any) => e.id === "a")!.name, "A2");
});

test("removeEntry: drops the matching id only", () => {
  const list = [{ id: "a", name: "A", savedAt: 1, def: {} }, { id: "b", name: "B", savedAt: 2, def: {} }];
  assert.deepEqual(removeEntry(list, "a").map((e: any) => e.id), ["b"]);
});
