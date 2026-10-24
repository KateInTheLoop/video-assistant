// Settings validation for the options page. Pure: no DOM, no storage.
// Empty means "not set" and is always allowed; a non-empty value must look right.
export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
export const STT_PROVIDERS = ["deepgram", "assemblyai"];
export const CONTEXT_TIERS = ["lean", "standard", "full"];

const RULES = {
  anthropicKey: { re: /^sk-ant-[\w-]{20,}$/, msg: "Anthropic key should start with sk-ant- and be about 100 characters" },
  deepgramKey: { re: /^[A-Za-z0-9]{36,}$/, msg: "Deepgram key should be the 40-character secret shown once when the key is created; a 32-character value is the key ID from the list, which does not work" },
  assemblyaiKey: { re: /^[A-Fa-f0-9]{32}$/, msg: "AssemblyAI key should be the 32-character key from the dashboard" },
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
  values.sttProvider = STT_PROVIDERS.includes(input.sttProvider) ? input.sttProvider : "deepgram";
  values.contextTier = CONTEXT_TIERS.includes(input.contextTier) ? input.contextTier : "full";
  for (const field of ["candidateName", "cvText", "jobDescription"]) values[field] = (input[field] || "").trim();
  return { values, errors };
}
