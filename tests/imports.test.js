import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// The browser glue at the repo root (panel.js, options.js, …) is never imported by a unit
// test, so a renamed or dropped export only shows up when the extension fails to load.
// This resolves every `import { names } from "./relative.js"` in root and lib/ files and
// checks each name is exported by the target.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  ...readdirSync(root).filter((f) => f.endsWith(".js")).map((f) => join(root, f)),
  ...readdirSync(join(root, "lib")).filter((f) => f.endsWith(".js")).map((f) => join(root, "lib", f)),
];

function exportsOf(path) {
  const src = readFileSync(path, "utf8");
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) { const t = part.trim(); if (!t) continue; const as = t.split(/\s+as\s+/); names.add((as[1] || as[0]).trim()); }
  }
  return names;
}

function importsOf(path) {
  const src = readFileSync(path, "utf8");
  const out = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    if (!m[2].startsWith(".")) continue;
    const names = m[1].split(",").map((t) => t.trim()).filter(Boolean).map((t) => t.split(/\s+as\s+/)[0].trim());
    out.push({ names, target: resolve(dirname(path), m[2]) });
  }
  return out;
}

test("every named import across root and lib/ resolves to a real export", () => {
  const problems = [];
  for (const f of files) {
    for (const { names, target } of importsOf(f)) {
      let exp;
      try { exp = exportsOf(target); } catch { problems.push(`${f}: cannot read ${target}`); continue; }
      for (const n of names) if (!exp.has(n)) problems.push(`${f.replace(root + "/", "")} imports {${n}} from ${target.replace(root + "/", "")}, which does not export it`);
    }
  }
  assert.deepEqual(problems, []);
});
