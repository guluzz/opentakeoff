// Storage adapter — the seam that replaces the backend.
//
// OpenTakeoff is client-only by default: the takeoff canvas talks to `store`,
// never to a server. Each PROJECT is its own IndexedDB database holding that
// project's plan PDFs and its annotations JSON; a small registry in localStorage
// lists the projects and which one is active. Every data method below operates on
// the ACTIVE project, so the canvas is unchanged — it just sees "the workspace".
//
//   listSheets()              -> [{ name }]                (active project's PDFs)
//   loadPdfData(name)         -> Uint8Array                (bytes for pdf.js)
//   loadAnnotations()         -> { conditions, shapes, ... }
//   saveAnnotations(payload)  -> Promise<void>
//   addPdf(file) / removePdf(name)
//   save/loadFileHandle()     -> the "Save project" target, per project
//
// Project management (registry + active pointer live in localStorage):
//   listProjects() / getActiveProject() / setActiveProject(id)
//   createProject(name) / renameProject(id,name) / deleteProject(id)

import {
  DEFAULT_PROJECT_ID, makeProject, upsertProject, renameInList,
  touchInList, removeFromList, nextActiveId,
} from "./projects.js";

const LEGACY_DB = "opentakeoff";        // the pre-multiproject workspace → the "default" project
const DB_PREFIX = "opentakeoff__";      // every other project: opentakeoff__<id>
const DB_VERSION = 1;
const PDF_STORE = "pdfs";               // key: file name -> { name, bytes: ArrayBuffer }
const META_STORE = "meta";              // key: "annotations" -> payload object
const ANN_KEY = "annotations";
const HANDLE_KEY = "project_file_handle";   // the "Save project" target (FileSystemFileHandle)
const ANN_SCHEMA = "opentakeoff.takeoff_canvas.v1";

const LS_PROJECTS = "opentakeoff_projects"; // registry: [{ id, name, createdAt, updatedAt }]
const LS_ACTIVE = "opentakeoff_active";     // active project id

const now = () => Date.now();
const newId = () => (globalThis.crypto?.randomUUID?.() || `p_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
const dbNameFor = (pid) => (pid === DEFAULT_PROJECT_ID ? LEGACY_DB : DB_PREFIX + pid);

// ── registry (localStorage) ──────────────────────────────────────────────────
function readProjects() {
  try { const v = JSON.parse(localStorage.getItem(LS_PROJECTS)); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function writeProjects(list) { try { localStorage.setItem(LS_PROJECTS, JSON.stringify(list)); } catch { /* private mode */ } }
function writeActive(id) { try { localStorage.setItem(LS_ACTIVE, id); } catch { /* private mode */ } }
function readActive() { try { return localStorage.getItem(LS_ACTIVE) || null; } catch { return null; } }

// Seed the default project on first run so the existing single workspace (already
// in the legacy DB) becomes project #1 with nothing copied.
function ensureInit() {
  let list = readProjects();
  if (!list.length) {
    list = [makeProject(DEFAULT_PROJECT_ID, "Project 1", now())];
    writeProjects(list);
    writeActive(DEFAULT_PROJECT_ID);
  } else if (!readActive() || !list.some((p) => p.id === readActive())) {
    writeActive((nextActiveId(list)) || list[0].id);
  }
  return list;
}
function activeId() { ensureInit(); return readActive() || DEFAULT_PROJECT_ID; }

// ── IndexedDB (one database per project) ─────────────────────────────────────
function openDB(pid) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbNameFor(pid), DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PDF_STORE)) db.createObjectStore(PDF_STORE, { keyPath: "name" });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function deleteDB(pid) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbNameFor(pid));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();   // another tab holds it open; it'll drop when that closes
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    const out = fn(os);
    t.oncomplete = () => resolve(out?.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const localStore = {
  async listSheets() {
    const db = await openDB(activeId());
    const names = await tx(db, PDF_STORE, "readonly", (os) => os.getAllKeys());
    db.close();
    // preserve insertion order (IndexedDB getAllKeys sorts by key; we keep the
    // saved order from annotations.sheet_tabs at the canvas layer, so name-sort
    // here is fine for the gallery)
    return (names || []).map((name) => ({ name }));
  },

  async loadPdfData(name) {
    const db = await openDB(activeId());
    const rec = await tx(db, PDF_STORE, "readonly", (os) => os.get(name));
    db.close();
    if (!rec) throw new Error(`PDF not found in local store: ${name}`);
    // hand pdf.js a fresh view each call — getDocument({data}) may detach it
    return new Uint8Array(rec.bytes);
  },

  async addPdf(file) {
    const bytes = await file.arrayBuffer();
    const db = await openDB(activeId());
    // de-dupe by name: a re-dropped file replaces the old bytes
    await tx(db, PDF_STORE, "readwrite", (os) => os.put({ name: file.name, bytes }));
    db.close();
    return { name: file.name };
  },

  async removePdf(name) {
    const db = await openDB(activeId());
    await tx(db, PDF_STORE, "readwrite", (os) => os.delete(name));
    db.close();
  },

  async loadAnnotations() {
    const db = await openDB(activeId());
    const a = await tx(db, META_STORE, "readonly", (os) => os.get(ANN_KEY));
    db.close();
    return a || { schema: ANN_SCHEMA, conditions: [], shapes: [], markups: [], sheets: [], sheet_group: [], last_group: [], sheet_tabs: [] };
  },

  async saveAnnotations(payload) {
    const pid = activeId();
    const db = await openDB(pid);
    await tx(db, META_STORE, "readwrite", (os) => os.put({ ...payload, schema: ANN_SCHEMA }, ANN_KEY));
    db.close();
    writeProjects(touchInList(readProjects(), pid, now()));   // updatedAt reflects last edit
  },

  // The chosen "Save project" file (a FileSystemFileHandle) is structured-
  // cloneable, so IndexedDB can persist it — Save then overwrites the same file
  // across a session instead of downloading a fresh copy each time. Per project.
  async saveFileHandle(handle) {
    const db = await openDB(activeId());
    await tx(db, META_STORE, "readwrite", (os) => os.put(handle, HANDLE_KEY));
    db.close();
  },

  async loadFileHandle() {
    const db = await openDB(activeId());
    const h = await tx(db, META_STORE, "readonly", (os) => os.get(HANDLE_KEY));
    db.close();
    return h || null;
  },

  // ── projects ───────────────────────────────────────────────────────────────
  async listProjects() { return ensureInit(); },

  async getActiveProject() {
    const list = ensureInit();
    const id = activeId();
    return list.find((p) => p.id === id) || list[0] || null;
  },

  async setActiveProject(id) { ensureInit(); writeActive(id); },

  // Create a new (empty) project. Does NOT switch to it — the caller decides.
  async createProject(name) {
    const list = ensureInit();
    const proj = makeProject(newId(), name || "Untitled project", now());
    writeProjects(upsertProject(list, proj));
    return proj;
  },

  async renameProject(id, name) {
    writeProjects(renameInList(ensureInit(), id, name, now()));
  },

  // Delete a project and its whole database. Returns the id that should be active
  // next (the most-recently-updated survivor, or null if none remain).
  async deleteProject(id) {
    const remaining = removeFromList(ensureInit(), id);
    writeProjects(remaining);
    await deleteDB(id);
    if (readActive() === id) {
      const next = nextActiveId(remaining);
      if (next) writeActive(next); else { try { localStorage.removeItem(LS_ACTIVE); } catch { /* ignore */ } }
      return next;
    }
    return readActive();
  },
};

// Optional backend adapter — implement the same methods against the `../server`
// AI sandbox (or any host) to enable shared/multi-device storage. Left
// intentionally unimplemented; the default build never touches it.
export const apiStore = null;

export const store = localStore;
export { ANN_SCHEMA };
