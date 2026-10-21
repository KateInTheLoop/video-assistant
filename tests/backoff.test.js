import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffDelays } from "../lib/backoff.js";
test("doubles from 1 s, three attempts", () => assert.deepEqual(backoffDelays(), [1000, 2000, 4000]));
test("configurable", () => assert.deepEqual(backoffDelays(500, 2), [500, 1000]));
