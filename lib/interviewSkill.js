export const INTERVIEW_SKILL_URL = new URL("../skills/interview-coach/SKILL.md", import.meta.url);

export function skillInstructions(markdown) {
  const body = String(markdown).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
  if (!body) throw new Error("Interview coach skill is empty.");
  return body;
}

export async function loadInterviewSkill() {
  // Node tests read the same asset as Chrome. Browser requests stay inside the extension;
  // the Markdown is not an Anthropic upload/file attachment or an automatically found skill.
  if (globalThis.process?.versions?.node) {
    const { readFile } = await import("node:fs/promises");
    return skillInstructions(await readFile(INTERVIEW_SKILL_URL, "utf8"));
  }
  const response = await fetch(INTERVIEW_SKILL_URL);
  if (!response.ok) throw new Error(`Cannot load interview coach skill (${response.status}). Reload the extension.`);
  return skillInstructions(await response.text());
}

// Loaded once per coach/settings window, preserving a stable prompt-cache prefix.
export const INTERVIEW_SKILL = await loadInterviewSkill();
