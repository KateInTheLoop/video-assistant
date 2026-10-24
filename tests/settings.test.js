import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSettings } from "../lib/settings.js";

const good = {
  anthropicKey: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123",
  deepgramKey: "0123456789abcdef0123456789abcdef01234567",
  model: "claude-opus-5-5",
  candidateName: " Kate ",
  cvText: "CV",
  jobDescription: "JD",
};

test("valid settings pass and text fields are trimmed", () => {
  const { values, errors } = validateSettings(good);
  assert.deepEqual(errors, {});
  assert.equal(values.anthropicKey, good.anthropicKey);
  assert.equal(values.candidateName, "Kate");
});

test("empty keys are allowed (means not set)", () => {
  const { values, errors } = validateSettings({ ...good, anthropicKey: "", deepgramKey: "  " });
  assert.deepEqual(errors, {});
  assert.equal(values.deepgramKey, "");
});

test("a malformed key is reported and left out of values", () => {
  const { values, errors } = validateSettings({ ...good, deepgramKey: "abc def" });
  assert.ok(errors.deepgramKey);
  assert.equal("deepgramKey" in values, false);
  assert.equal(values.anthropicKey, good.anthropicKey);
});

test("wrong Anthropic prefix is rejected", () => {
  const { errors } = validateSettings({ ...good, anthropicKey: "0123456789abcdefghijklmnop" });
  assert.ok(errors.anthropicKey);
});

test("unknown model is reported", () => {
  const { values, errors } = validateSettings({ ...good, model: "gpt-9" });
  assert.ok(errors.model);
  assert.equal("model" in values, false);
});

test("a 32-char Deepgram key ID is rejected with an explanation", () => {
  const { errors } = validateSettings({ ...good, deepgramKey: "0a1b2c3d4e5f60718293a4b5c6d7e8f9" });
  assert.match(errors.deepgramKey, /key ID/);
});
