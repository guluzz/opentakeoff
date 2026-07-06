import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeProject, upsertProject, renameInList, touchInList,
  removeFromList, nextActiveId, displayName, DEFAULT_PROJECT_ID,
} from "../src/lib/projects.js";

const p = (id: string, name: string, updatedAt: number) => ({ id, name, createdAt: 0, updatedAt });

test("makeProject: trims the name and stamps timestamps", () => {
  const proj = makeProject("p1", "  Maple St  ", 1000);
  assert.equal(proj.id, "p1");
  assert.equal(proj.name, "Maple St");
  assert.equal(proj.createdAt, 1000);
  assert.equal(proj.updatedAt, 1000);
});

test("upsertProject: appends a new id, replaces an existing one (never duplicates)", () => {
  let list = [p("a", "A", 1)];
  list = upsertProject(list, p("b", "B", 2));
  assert.deepEqual(list.map((x: any) => x.id), ["a", "b"]);
  list = upsertProject(list, { ...p("a", "A2", 3) });
  assert.equal(list.length, 2);                       // no duplicate 'a'
  assert.equal(list.find((x: any) => x.id === "a")!.name, "A2");
});

test("renameInList / touchInList: update only the target, bump updatedAt", () => {
  const list = [p("a", "A", 1), p("b", "B", 1)];
  const renamed = renameInList(list, "b", "  Beta ", 5);
  assert.equal(renamed.find((x: any) => x.id === "b")!.name, "Beta");
  assert.equal(renamed.find((x: any) => x.id === "b")!.updatedAt, 5);
  assert.equal(renamed.find((x: any) => x.id === "a")!.name, "A");   // untouched
  const touched = touchInList(list, "a", 9);
  assert.equal(touched.find((x: any) => x.id === "a")!.updatedAt, 9);
});

test("nextActiveId: after a delete, falls to the most-recently-updated survivor", () => {
  const list = [p("a", "A", 10), p("b", "B", 30), p("c", "C", 20)];
  const remaining = removeFromList(list, "b");          // delete the newest
  assert.deepEqual(remaining.map((x: any) => x.id), ["a", "c"]);
  assert.equal(nextActiveId(remaining), "c");           // c (20) is newer than a (10)
});

test("nextActiveId: null when nothing remains (caller seeds a fresh default)", () => {
  assert.equal(nextActiveId(removeFromList([p("a", "A", 1)], "a")), null);
});

test("displayName: never blank", () => {
  assert.equal(displayName(p("a", "Job", 1)), "Job");
  assert.equal(displayName(p("a", "   ", 1)), "Untitled project");
  assert.equal(displayName(null as any), "Untitled project");
});

test("DEFAULT_PROJECT_ID is stable (legacy DB mapping depends on it)", () => {
  assert.equal(DEFAULT_PROJECT_ID, "default");
});
