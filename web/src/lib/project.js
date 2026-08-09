// Project files — a single portable archive of an entire takeoff so it survives
// a browser-data wipe (and can move between machines). Save writes every sheet
// PDF plus the annotations JSON into one .zip; Open imports one as a new project.
//
//   buildProjectZip(annotations, opts)  -> { bytes, filename, sheets }  (in memory)
//   resolveSaveTarget(opts) / writeToTarget(target, bytes, name)        (save-to-file)
//   importProject(file, { onProgress }) -> new project from the archive, resolves { sheets, projectId, projectName }
//   isProjectArchive(file)              -> Promise<boolean>  (has our manifest?)
//
// The archive is a normal .zip so it's transparent, but a manifest file marks it
// as a project (vs. a plain plan-set zip) and carries the full editable state:
//
//   opentakeoff-project.json   { format, version, saved_at, annotations }
//   sheets/<file name>         the raw PDF bytes, one per sheet
//
// fflate is loaded on demand (same as ingest) so it never weighs down page load.

import { store } from "./store.js";

const MANIFEST = "opentakeoff-project.json";
const SHEETS_DIR = "sheets/";
const FORMAT = "opentakeoff-project";
const VERSION = 1;

const baseName = (path) => path.split("/").pop() || path;

function safeName(name) {
  // keep it a readable filename; strip anything that could break a path
  const stem = String(name || "takeoff").replace(/[/\\:*?"<>|]+/g, "_").trim() || "takeoff";
  return stem.replace(/\.zip$/i, "");
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Build the project .zip in memory: pull every sheet's bytes from the store and
// bundle them with the (freshest) annotations passed in by the caller. Returns
// the bytes + a suggested filename so the caller can either overwrite a chosen
// file (File System Access) or fall back to a download.
export async function buildProjectZip(annotations, { onProgress, baseName } = {}) {
  const { zip } = await import("fflate");
  const files = {};

  const manifest = { format: FORMAT, version: VERSION, saved_at: new Date().toISOString(), annotations: annotations || {} };
  files[MANIFEST] = [new TextEncoder().encode(JSON.stringify(manifest, null, 2)), { level: 6 }];

  const sheets = await store.listSheets();
  let i = 0;
  for (const s of sheets) {
    onProgress?.(`Packing ${++i}/${sheets.length}: ${s.name}…`);
    const bytes = await store.loadPdfData(s.name);
    // PDFs are already compressed — store them without re-deflating (level 0) so
    // big plan sets pack fast and don't balloon CPU.
    files[SHEETS_DIR + s.name] = [bytes, { level: 0 }];
  }

  onProgress?.("Compressing…");
  const zipped = await new Promise((resolve, reject) =>
    zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data))));

  const base = safeName(baseName || `${annotations?.project_name || "takeoff"}-opentakeoff`);
  return { bytes: zipped, filename: `${base}.zip`, sheets: sheets.length };
}

// ── save-to-a-real-file (File System Access) ─────────────────────────────────
// Overwrite the same .zip on repeat saves instead of piling copies in Downloads.
// Chrome/Edge only; everywhere else we transparently fall back to a download.
export function supportsFsAccess() {
  return typeof window !== "undefined" && typeof window.showSaveFilePicker === "function";
}

async function ensurePermission(handle) {
  const opts = { mode: "readwrite" };
  try {
    if ((await handle.queryPermission(opts)) === "granted") return true;
    return (await handle.requestPermission(opts)) === "granted";
  } catch { return false; }
}

// Decide WHERE a save goes — resolved up front, while we still hold the click's
// user-activation (showSaveFilePicker needs it; a long zip build would burn it).
// Returns { kind: 'file', handle } | { kind: 'download' } | { kind: 'cancel' }.
export async function resolveSaveTarget({ allowPicker = true, suggestedName } = {}) {
  if (!supportsFsAccess()) return { kind: "download" };
  let handle = null;
  try { handle = await store.loadFileHandle(); } catch { handle = null; }
  if (handle && !(await ensurePermission(handle))) handle = null;   // grant revoked → re-pick
  if (handle) return { kind: "file", handle };
  if (!allowPicker) return { kind: "download" };
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: suggestedName || "takeoff-opentakeoff.zip",
      types: [{ description: "OpenTakeoff project", accept: { "application/zip": [".zip"] } }],
    });
  } catch (e) {
    if (e && e.name === "AbortError") return { kind: "cancel" };
    return { kind: "download" };   // picker unavailable for some other reason → still save
  }
  try { await store.saveFileHandle(handle); } catch { /* handle just won't persist */ }
  return { kind: "file", handle };
}

// Write the zip bytes to a resolved target. Returns { where, name }.
export async function writeToTarget(target, bytes, filename) {
  const blob = new Blob([bytes], { type: "application/zip" });
  if (target && target.kind === "file") {
    const w = await target.handle.createWritable();
    await w.write(blob);
    await w.close();
    return { where: "file", name: target.handle.name || filename };
  }
  downloadBlob(filename, blob);
  return { where: "download", name: filename };
}

async function readZip(file) {
  const { unzip } = await import("fflate");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) =>
    unzip(bytes, (err, data) => (err ? reject(err) : resolve(data))));
}

// Does this file carry our manifest? Lets the UI route a project archive to
// restore, and a plain plan-set zip to the normal ingest path.
export async function isProjectArchive(file) {
  try {
    const entries = await readZip(file);
    return Object.prototype.hasOwnProperty.call(entries, MANIFEST);
  } catch { return false; }
}

// Open: restore the archive into a BRAND-NEW project and switch to it. Nothing
// existing is touched — importing is purely additive, so there's no destructive
// overwrite to guard against. Returns the new project's id + name.
export async function importProject(file, { onProgress } = {}) {
  onProgress?.("Reading project…");
  const entries = await readZip(file);

  const manifestBytes = entries[MANIFEST];
  if (!manifestBytes) throw new Error("Not an OpenTakeoff project file (no manifest inside).");
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(manifestBytes)); }
  catch { throw new Error("Project manifest is corrupt."); }
  if (manifest.format !== FORMAT) throw new Error("Unrecognized project format.");

  // Create the destination project and make it active BEFORE writing, so every
  // store.addPdf / saveAnnotations lands in the new project's database.
  const name = (manifest.annotations && manifest.annotations.project_name) || "Imported project";
  const proj = await store.createProject(name);
  await store.setActiveProject(proj.id);

  const sheetPaths = Object.keys(entries).filter((p) => p.startsWith(SHEETS_DIR) && p !== SHEETS_DIR);
  let i = 0;
  for (const path of sheetPaths) {
    const sheetName = baseName(path);
    onProgress?.(`Restoring ${++i}/${sheetPaths.length}: ${sheetName}…`);
    const f = new File([entries[path]], sheetName, { type: "application/pdf" });
    await store.addPdf(f);
  }

  onProgress?.("Restoring takeoff…");
  await store.saveAnnotations(manifest.annotations || {});
  return { sheets: sheetPaths.length, projectId: proj.id, projectName: name };
}
