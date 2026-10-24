// Settings validation for the options page. Pure: no DOM, no storage.
// Empty means "not set" and is always allowed; a non-empty value must look right.
export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

const RULES = {
  anthropicKey: { re: /^sk-ant-[\w-]{20,}$/, msg: "Anthropic key should start with sk-ant- and be about 100 characters" },
  deepgramKey: { re: /^[A-Za-z0-9]{36,}$/, msg: "Deepgram key should be the 40-character secret shown once when the key is created; a 32-character value is the key ID from the list, which does not work" },
};

// Returns { values, errors }. `values` holds only the fields that passed;
// `errors` maps a field name to a message. Plain text fields always pass.
export function validateSettings(input) {
  const values = {};
  const errors = {};
  for (const [field, rule] of Object.entries(RULES)) {
    const v = (input[field] || "").trim();
    if (v === "" || rule.re.test(v)) values[field] = v;
    else errors[field] = rule.msg;
  }
  if (MODELS.includes(input.model)) values.model = input.model;
  else errors.model = "Pick one of the Claude models in the list";
  for (const field of ["candidateName", "cvText", "jobDescription"]) values[field] = (input[field] || "").trim();
  return { values, errors };
}
