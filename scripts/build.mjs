// Package the extension into dist/interview-coach-v<version>.zip, ready to unzip and
// "Load unpacked" in chrome://extensions, or to upload to the Chrome Web Store.
// Dependency-free: stages an allowlist of runtime files, then shells out to `zip`.
import { mkdirSync, rmSync, cpSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const version = manifest.version;
const name = "interview-coach";

// Everything the loaded extension needs at runtime, plus the user-facing docs. Nothing from
// tests/, scripts/, .github/, and no planning files.
const FILES = [
  "manifest.json",
  "background.js", "storage.js", "claude.js",
  "panel.html", "panel.css", "panel.js",
  "options.html", "options.js",
  "stt.js", "stt-assemblyai.js", "webspeech.js", "pcm-worklet.js",
  "README.md", "docs/first-run.md",
];

const dist = join(root, "dist");
const stage = join(dist, name);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

for (const rel of FILES) {
  const src = join(root, rel);
  if (!existsSync(src)) throw new Error(`build: missing file ${rel}`);
  const dest = join(stage, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
}
// All of lib/ (runtime modules) and icons/.
for (const dir of ["lib", "icons"]) {
  mkdirSync(join(stage, dir), { recursive: true });
  for (const f of readdirSync(join(root, dir))) cpSync(join(root, dir, f), join(stage, dir, f));
}

const zipPath = join(dist, `${name}-v${version}.zip`);
rmSync(zipPath, { force: true });
// Zip from inside the staging dir so the archive root holds manifest.json directly
// (what the Chrome Web Store requires; Load-unpacked users just unzip and pick the folder).
execFileSync("zip", ["-r", "-q", zipPath, "."], { cwd: stage });

const count = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" }).trim().split("\n").length - 4;
console.log(`built ${zipPath} (${count} files, version ${version})`);
