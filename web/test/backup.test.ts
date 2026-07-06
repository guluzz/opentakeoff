import { test } from "node:test";
import assert from "node:assert/strict";
import { hashStr, payloadSig, relTime, backupState } from "../src/lib/backup.js";

// The dirty check is the safety-critical bit: a payload that changed MUST get a
// different signature (else the gallery says "backed up" when it isn't).

const base = (): any => ({
  project_name: "Job A",
  sheets: [{ sheet_id: "A1.pdf", units_per_px: 0.04 }],
  conditions: [{ id: "c1", finish_tag: "LVT-1" }],
  shapes: [{ id: "s1", condition_id: "c1", verts_norm: [[0.1, 0.1], [0.2, 0.2]] }],
  markups: [],
  sheet_group: [], last_group: [], sheet_tabs: ["A1.pdf"],
});

test("payloadSig: identical content → identical signature", () => {
  assert.equal(payloadSig(base()), payloadSig(base()));
});

test("payloadSig: any real change → different signature", () => {
  const sig = payloadSig(base());
  const addShape = base(); addShape.shapes.push({ id: "s2", condition_id: "c1", verts_norm: [[0.3, 0.3], [0.4, 0.4]] });
  const moveVert = base(); moveVert.shapes[0].verts_norm[1] = [0.25, 0.25];
  const renameProj = base(); renameProj.project_name = "Job B";
  const addMarkup = base(); addMarkup.markups.push({ id: "m1", type: "text", text: "note" });
  const changeScale = base(); changeScale.sheets[0].units_per_px = 0.05;
  for (const [name, p] of [["add shape", addShape], ["move vertex", moveVert], ["rename project", renameProj], ["add markup", addMarkup], ["change scale", changeScale]] as const) {
    assert.notEqual(payloadSig(p), sig, `${name} should change the signature`);
  }
});

test("hashStr: deterministic and non-trivially distributed", () => {
  assert.equal(hashStr("hello"), hashStr("hello"));
  assert.notEqual(hashStr("hello"), hashStr("hellp"));   // one-char change
  assert.notEqual(hashStr(""), hashStr("a"));
});

test("backupState: a confirmed file backup matching the work reads green", () => {
  const st = backupState({ sig: "A", exportedSig: "A", exportedAt: 100, downloadSig: "", downloadAt: null });
  assert.deepEqual(st, { tone: "ok", reason: "confirmed" });
});

test("backupState: an unverifiable download NEVER reads green — the reported bug", () => {
  // user cancelled the browser's download dialog, but we recorded the attempt:
  // it must be 'info' (unverified), not 'ok' (backed up).
  const st = backupState({ sig: "A", exportedSig: "", exportedAt: null, downloadSig: "A", downloadAt: 100 });
  assert.equal(st.tone, "info");
  assert.equal(st.reason, "downloaded");
  assert.notEqual(st.tone, "ok");
});

test("backupState: a confirmed backup outranks a download of the same work", () => {
  const st = backupState({ sig: "A", exportedSig: "A", exportedAt: 200, downloadSig: "A", downloadAt: 100 });
  assert.equal(st.reason, "confirmed");   // green wins when both match
});

test("backupState: edited since any prior backup/export → warn", () => {
  assert.equal(backupState({ sig: "B", exportedSig: "A", exportedAt: 100, downloadSig: "", downloadAt: null }).reason, "edited");
  assert.equal(backupState({ sig: "B", exportedSig: "", exportedAt: null, downloadSig: "A", downloadAt: 100 }).reason, "edited");
});

test("backupState: nothing ever exported → warn/never", () => {
  assert.deepEqual(backupState({ sig: "A", exportedSig: "", exportedAt: null, downloadSig: "", downloadAt: null }),
    { tone: "warn", reason: "never" });
});

test("relTime: buckets seconds/minutes/hours/days", () => {
  const t = 1_000_000_000_000;
  assert.equal(relTime(t, t + 10_000), "just now");        // 10s
  assert.equal(relTime(t, t + 5 * 60_000), "5 min ago");   // 5m
  assert.equal(relTime(t, t + 2 * 3_600_000), "2 h ago");  // 2h
  assert.equal(relTime(t, t + 3 * 86_400_000), "3 d ago"); // 3d
  assert.equal(relTime(t, t - 5000), "just now");          // clock skew → clamped, never negative
});
