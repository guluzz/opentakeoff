import { test } from "node:test";
import assert from "node:assert/strict";
import { zip, unzip } from "fflate";
import { writeToTarget } from "../src/lib/project.js";

// project.js is browser-coupled (IndexedDB store + DOM download), so this test
// guards the ARCHIVE FORMAT CONTRACT it relies on: the same manifest + sheets/
// layout, packed and read back through the real fflate the app uses. A format
// regression (renamed manifest, lost bytes, broken JSON) fails here.

const MANIFEST = "opentakeoff-project.json";
const SHEETS_DIR = "sheets/";
const FORMAT = "opentakeoff-project";

const zipAsync = (files: Record<string, any>): Promise<Uint8Array> =>
  new Promise((res, rej) => zip(files, { level: 6 }, (e, d) => (e ? rej(e) : res(d))));
const unzipAsync = (bytes: Uint8Array): Promise<Record<string, Uint8Array>> =>
  new Promise((res, rej) => unzip(bytes, (e, d) => (e ? rej(e) : res(d))));

// a realistic annotations payload (the shape the canvas saves/loads)
const annotations = {
  project_name: "Maple St Job",
  conditions: [{ id: "c1", finish_tag: "LVT-1", waste_pct: 8 }],
  shapes: [{ id: "s1", condition_id: "c1", measure_role: "floor_area", verts_norm: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]], computed: { area_sf: 123.45 } }],
  markups: [{ id: "m1", type: "text", text: "note ✎ with unicode ½\"" }],
  sheets: [{ sheet_id: "A1.pdf", units_per_px: 0.0416 }],
  sheet_tabs: ["A1.pdf"],
};
// fake but non-trivial PDF bytes, incl. the %PDF header and high bytes
const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0xff, 0x80, 0x01, 0xfe]);

async function buildArchive() {
  const files: Record<string, any> = {};
  const manifest = { format: FORMAT, version: 1, saved_at: "2026-07-05T00:00:00.000Z", annotations };
  files[MANIFEST] = [new TextEncoder().encode(JSON.stringify(manifest)), { level: 6 }];
  files[SHEETS_DIR + "A1.pdf"] = [pdfBytes, { level: 0 }];
  return zipAsync(files);
}

test("project archive: manifest is present and marks the format", async () => {
  const entries = await unzipAsync(await buildArchive());
  assert.ok(Object.prototype.hasOwnProperty.call(entries, MANIFEST), "manifest entry exists");
  const m = JSON.parse(new TextDecoder().decode(entries[MANIFEST]));
  assert.equal(m.format, FORMAT);
});

test("project archive: annotations survive the JSON round-trip intact", async () => {
  const entries = await unzipAsync(await buildArchive());
  const m = JSON.parse(new TextDecoder().decode(entries[MANIFEST]));
  assert.deepEqual(m.annotations, annotations);
  // spot-check the values most likely to be corrupted by a bad round-trip
  assert.equal(m.annotations.shapes[0].computed.area_sf, 123.45);
  assert.equal(m.annotations.markups[0].text, 'note ✎ with unicode ½"');
});

test("project archive: PDF bytes are byte-for-byte identical after packing", async () => {
  const entries = await unzipAsync(await buildArchive());
  const out = entries[SHEETS_DIR + "A1.pdf"];
  assert.deepEqual([...out], [...pdfBytes]);
});

test("project archive: a plain plan-set zip (no manifest) is NOT a project", async () => {
  const bytes = await zipAsync({ "A1.pdf": [pdfBytes, { level: 0 }] });
  const entries = await unzipAsync(bytes);
  assert.ok(!Object.prototype.hasOwnProperty.call(entries, MANIFEST), "no manifest → routed to plan ingest, not restore");
});

// save-to-same-file: writing to a file target must land the exact bytes and close
// the stream (a leaked/unclosed writable can leave a truncated .zip on disk).
test("writeToTarget: file target writes exact bytes, closes the stream, reports its name", async () => {
  const chunks: any[] = [];
  let closed = false;
  const handle = {
    name: "MyJob.zip",
    createWritable: async () => ({
      write: async (b: any) => { chunks.push(b); },
      close: async () => { closed = true; },
    }),
  };
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
  const res = await writeToTarget({ kind: "file", handle } as any, bytes, "fallback.zip");

  assert.equal(res.where, "file");
  assert.equal(res.name, "MyJob.zip");          // reports the real file, not the fallback name
  assert.equal(closed, true, "writable must be closed or the file may be truncated");
  const written = new Uint8Array(await chunks[0].arrayBuffer());
  assert.deepEqual([...written], [...bytes]);
});
