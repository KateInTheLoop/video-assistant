// The ten questions that cover most behavioral interviews. Answers become story-bank entries.
export const STANDARD_QUESTIONS = [
  { tag: "failure", q: "Tell me about a time you failed or made a significant mistake. What happened and what did you do afterwards?" },
  { tag: "conflict", q: "Describe a disagreement with a colleague or manager. How did you handle it and how did it end?" },
  { tag: "leadership", q: "Tell me about a time you led people or a project without formal authority." },
  { tag: "ambiguity", q: "Describe a situation where the goal or requirements were unclear. How did you move forward?" },
  { tag: "impact", q: "What is the piece of work you are proudest of? What changed because of it, ideally with numbers?" },
  { tag: "pressure", q: "Tell me about a time with a hard deadline or a production incident. What did you do first?" },
  { tag: "influence", q: "Describe a time you changed someone's mind, or had your own mind changed by evidence." },
  { tag: "learning", q: "Tell me about something you had to learn fast to get a job done." },
  { tag: "feedback", q: "Tell me about tough feedback you received. What did you do with it?" },
  { tag: "prioritisation", q: "Describe a time you had too much to do. How did you decide what to drop?" },
];

export const STORY_FROM_ANSWER_SCHEMA = {
  type: "object", additionalProperties: false, required: ["title", "situation", "action", "result", "tags", "missing"],
  properties: {
    title: { type: "string", description: "3-6 words the candidate will recognise instantly." },
    situation: { type: "string", description: "In the candidate's own words, tightened. Do not add facts." },
    action: { type: "string", description: "What THEY did, own words." },
    result: { type: "string", description: "Outcome in own words; keep numbers exactly as given. If none given, write what is given and nothing more." },
    tags: { type: "string", description: "Comma separated themes, include the question's tag." },
    missing: { type: "array", items: { type: "string" }, description: "What a strong answer still lacks (e.g. 'a number for the result', 'what you learned'). Max 3." },
  },
};

export function nextIndex(stories, questions = STANDARD_QUESTIONS) {
  // First question whose tag has no story from the interview yet.
  const covered = new Set(stories.filter((s) => s.source === "interview").map((s) => s.interviewTag));
  const i = questions.findIndex((q) => !covered.has(q.tag));
  return i; // -1 when all covered
}
