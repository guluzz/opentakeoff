import { test } from "node:test";
import assert from "node:assert/strict";
// totals.js is plain JS (allowJs); the tsx loader resolves it from the .ts test.
import { conditionTotals, materialsSummary, bidTotals } from "../src/lib/totals.js";

const area = (id: string, sf: number) => ({ condition_id: id, measure_role: "floor_area", computed: { area_sf: sf } });
const lin = (id: string, lf: number) => ({ condition_id: id, measure_role: "linear", computed: { perimeter_lf: lf } });
const cnt = (id: string) => ({ condition_id: id, measure_role: "count", computed: { count: 1 } });

test("pricing: material on order-qty (with waste), labor on measured-qty", () => {
  const conds = [{ id: "lvt", finish_tag: "LVT-1", waste_pct: 10, price_material: 2, price_labor: 3 }];
  const [r] = conditionTotals(conds, [area("lvt", 100)]);
  assert.equal(r.price_unit, "SF");
  assert.equal(r.material_cost, 220); // 100 * 1.10 waste * $2
  assert.equal(r.labor_cost, 300);    // 100 measured * $3
  assert.equal(r.line_total, 520);
});

test("pricing: linear condition prices per LF; count prices per EA (no waste on count)", () => {
  const [lr] = conditionTotals([{ id: "rb", finish_tag: "RB-1", waste_pct: 5, price_material: 1, price_labor: 2 }], [lin("rb", 100)]);
  assert.equal(lr.price_unit, "LF");
  assert.equal(lr.material_cost, 105); // 100 * 1.05 * $1
  assert.equal(lr.labor_cost, 200);    // 100 * $2
  const [cr] = conditionTotals([{ id: "tr", finish_tag: "TR-1", waste_pct: 50, price_material: 4, price_labor: 6 }], [cnt("tr"), cnt("tr")]);
  assert.equal(cr.price_unit, "EA");
  assert.equal(cr.material_cost, 8);   // 2 EA * $4 (waste ignored for counts)
  assert.equal(cr.labor_cost, 12);
});

test("pricing: no unit price → zero cost, priced=false in the bid", () => {
  const rows = conditionTotals([{ id: "a", finish_tag: "A" }], [area("a", 100)]);
  assert.equal(rows[0].line_total, 0);
  assert.equal(bidTotals(rows).priced, false);
});

test("bidTotals: tax on material, overhead on cost, profit markup on the rest", () => {
  const rows = conditionTotals([{ id: "lvt", finish_tag: "LVT-1", waste_pct: 10, price_material: 2, price_labor: 3 }], [area("lvt", 100)]);
  const b = bidTotals(rows, { tax_pct: 8, overhead_pct: 10, profit_pct: 15 });
  assert.equal(b.material_subtotal, 220);
  assert.equal(b.labor_subtotal, 300);
  assert.equal(b.cost_subtotal, 520);
  assert.equal(b.tax, 17.6);        // 8% of 220 material
  assert.equal(b.overhead, 52);     // 10% of 520 cost
  assert.equal(b.profit, 88.44);    // 15% of (520 + 17.6 + 52 = 589.6)
  assert.equal(b.bid_total, 678.04);
  assert.equal(b.priced, true);
});

test("bidTotals: zero markups → bid equals cost subtotal", () => {
  const rows = conditionTotals([{ id: "lvt", finish_tag: "LVT-1", price_material: 1, price_labor: 1 }], [area("lvt", 50)]);
  const b = bidTotals(rows, {});
  assert.equal(b.bid_total, b.cost_subtotal);
});

test("materials: order qty = area ÷ coverage, rounded up to whole units", () => {
  const conds = [{
    id: "ct", finish_tag: "CT-1",
    materials: [
      { id: "m1", name: "Thinset", per: 95, basis: "area", unit: "bag", round: true },
      { id: "m2", name: "Grout", per: 120, basis: "area", unit: "bag", round: true },
    ],
  }];
  const [row] = conditionTotals(conds, [area("ct", 234)]);
  const byName = Object.fromEntries(row.materials.map((m: any) => [m.name, m.qty]));
  assert.equal(byName.Thinset, 3); // ceil(234/95) = ceil(2.46)
  assert.equal(byName.Grout, 2);   // ceil(234/120) = ceil(1.95)
});

test("materials: round:false keeps the fractional quantity", () => {
  const conds = [{ id: "lvt", finish_tag: "LVT-1", materials: [{ id: "m", name: "Adhesive", per: 250, basis: "area", unit: "gal", round: false }] }];
  const [row] = conditionTotals(conds, [area("lvt", 600)]);
  assert.equal(row.materials[0].qty, 2.4); // 600/250, not rounded
});

test("materials: multiplier scales the basis before dividing", () => {
  const conds = [{ id: "ct", finish_tag: "CT-1", multiplier: 2, materials: [{ id: "m", name: "Thinset", per: 95, basis: "area", unit: "bag", round: true }] }];
  const [row] = conditionTotals(conds, [area("ct", 234)]); // 234 × 2 = 468
  assert.equal(row.materials[0].qty, 5); // ceil(468/95) = ceil(4.92)
});

test("materials: linear basis uses measured LF, not area", () => {
  const conds = [{ id: "rb", finish_tag: "RB-1", materials: [{ id: "m", name: "Cove base adhesive", per: 40, basis: "linear", unit: "tube", round: true }] }];
  const [row] = conditionTotals(conds, [lin("rb", 130)]);
  assert.equal(row.materials[0].qty, 4); // ceil(130/40) = ceil(3.25)
});

test("materials: note (trowel / coats) passes through to the row", () => {
  const conds = [{
    id: "wd", finish_tag: "WD-1",
    materials: [{ id: "m", name: "Adhesive", per: 55, basis: "area", unit: "gal", round: true, note: "3/16″ V-notch" }],
  }];
  const [row] = conditionTotals(conds, [area("wd", 110)]);
  assert.equal(row.materials[0].note, "3/16″ V-notch");
  assert.equal(row.materials[0].qty, 2); // ceil(110/55)
});

test("materialsSummary: same-named materials sum across conditions", () => {
  const conds = [
    { id: "a", finish_tag: "CT-1", materials: [{ id: "1", name: "Grout", per: 120, basis: "area", unit: "bag", round: true }] },
    { id: "b", finish_tag: "CT-2", materials: [{ id: "2", name: "Grout", per: 120, basis: "area", unit: "bag", round: true }] },
  ];
  const rows = conditionTotals(conds, [area("a", 234), area("b", 100)]);
  const summary = materialsSummary(rows);
  const grout = summary.find((s: any) => s.name === "Grout");
  assert.equal(grout.qty, 3); // 2 (CT-1) + 1 (CT-2)
});
