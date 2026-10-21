import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("manifest is valid MV3", () => {
  const m = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url)));
  assert.equal(m.manifest_version, 3);
  assert.ok(m.background.service_worker);
});

test("manifest host_permissions use valid match patterns", () => {
  const m = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url)));
  for (const h of m.host_permissions) assert.match(h, /^(https?|\*):\/\/[^/]+\/.*$/, h);
});
