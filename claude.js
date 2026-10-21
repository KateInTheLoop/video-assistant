// Raw Messages API calls. No bundler in this extension, so we use fetch directly.
import { HINT_SCHEMA } from "./lib/hintSchema.js";
import { recent } from "./lib/transcript.js";

const API = "https://api.anthropic.com/v1/messages";

function headers(apiKey, betas = []) {
  const h = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (betas.length) h["anthropic-beta"] = betas.join(",");
  return h;
}

async function call(apiKey, body, betas) {
  const res = await fetch(API, { method: "POST", headers: headers(apiKey, betas), body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 300)}`);
  }
  const msg = await res.json();
  if (msg.stop_reason === "refusal") throw new Error("Claude declined this request.");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

// --- Live hint -------------------------------------------------------------

const HINT_SYSTEM = `You are a quiet interview coach sitting next to a candidate during a live video interview.
You see the rolling transcript. The INTERVIEWER lines come from the call audio, the CANDIDATE lines from the candidate's microphone.

Your job is to reduce cognitive load, not to answer for the candidate:
- Tell them what was actually asked, in a few words.
- Point at which of THEIR OWN stories fit. Only use stories from the story bank, by exact title. Never invent experience.
- Give at most four keywords to structure the answer. Keywords, never sentences. The candidate must speak in their own words.
- Flag a trap if there is one (multi-part question, asked for a failure, asked for numbers).

If the interviewer's latest utterance is not a question (small talk, explaining the role, still mid-sentence), set is_question=false and leave the rest minimal.
Be fast and terse. Respond only with the JSON object.`;

export async function getHint({ apiKey, model, transcript, stories, jobDescription, cvText }) {
  const bank = stories.length
    ? stories.map((s) => `### ${s.title}\nTags: ${s.tags || ""}\nSituation: ${s.situation}\nAction: ${s.action}\nResult: ${s.result}`).join("\n\n")
    : "(empty)";
  const recentLines = recent(transcript, 14);

  const system = [
    { type: "text", text: HINT_SYSTEM },
    // Stable candidate context goes before the cache breakpoint so every hint call reuses it.
    { type: "text", text: `# Story bank\n${bank}\n\n# Job description\n${jobDescription || "(none)"}\n\n# CV\n${cvText || "(none)"}`, cache_control: { type: "ephemeral" } },
  ];

  return call(apiKey, {
    model,
    max_tokens: 1024,
    output_config: { effort: "low", format: { type: "json_schema", schema: HINT_SCHEMA } },
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: `Rolling transcript (most recent last):\n\n${recentLines}\n\nProduce the hint for the interviewer's latest utterance.` }],
  }, ["server-side-fallback-2026-07-01"]);
}

// --- Prep: extract stories from CV ------------------------------------------

const STORIES_SCHEMA = {
  type: "object", additionalProperties: false, required: ["stories", "likely_questions"],
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["title", "situation", "action", "result", "tags"],
        properties: {
          title: { type: "string", description: "Short memorable title, 3-6 words." },
          situation: { type: "string" },
          action: { type: "string" },
          result: { type: "string", description: "Include numbers if the CV has them. Say 'result not stated in CV' if unknown." },
          tags: { type: "string", description: "Comma separated: leadership, conflict, failure, ambiguity, technical, impact, etc." },
        },
      },
    },
    likely_questions: { type: "array", items: { type: "string" }, description: "8-12 questions this job description makes likely." },
  },
};

export async function extractStories({ apiKey, model, cvText, jobDescription }) {
  return call(apiKey, {
    model,
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: STORIES_SCHEMA } },
    fallbacks: "default",
    system: `You help a candidate prepare for interviews. From their CV, draft a bank of concrete stories in STAR form (situation, action, result).
Draft only what the CV supports. Where the CV is vague, keep the draft short and mark what the candidate needs to fill in; the candidate will edit every story in their own words before using it.
Then, given the job description, list the questions most likely to come up. Respond only with the JSON object.`,
    messages: [{ role: "user", content: `# CV\n${cvText}\n\n# Job description\n${jobDescription || "(none provided)"}` }],
  }, ["server-side-fallback-2026-07-01"]);
}
