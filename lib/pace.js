// Per-answer pacing from the saved transcript. An "answer" is a run of candidate lines
// following an interviewer line. Timestamps are the line's last-updated time, so we use
// the gap to the next line as the speaking duration; the final answer gets the session end.
export const LONG_ANSWER_S = 120;
export const SHORT_ANSWER_S = 20;

export function answerStats(lines, sessionEnd) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].speaker !== "interviewer") { i++; continue; }
    const question = lines[i].text;
    let j = i + 1;
    while (j < lines.length && lines[j].speaker === "candidate") j++;
    if (j > i + 1) {
      const startT = lines[i].t;
      const endT = j < lines.length ? lines[j].t : sessionEnd ?? lines[j - 1].t;
      const words = lines.slice(i + 1, j).reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
      const seconds = Math.max(0, Math.round((endT - startT) / 1000));
      out.push({ question, seconds, words, wpm: seconds ? Math.round((words / seconds) * 60) : 0,
        flag: seconds > LONG_ANSWER_S ? "long" : seconds < SHORT_ANSWER_S ? "short" : "" });
    }
    i = j;
  }
  return out;
}

export function paceSummary(stats) {
  if (!stats.length) return { answers: 0, medianSeconds: 0, long: 0, short: 0 };
  const s = stats.map((a) => a.seconds).sort((a, b) => a - b);
  return { answers: stats.length, medianSeconds: s[Math.floor(s.length / 2)],
    long: stats.filter((a) => a.flag === "long").length, short: stats.filter((a) => a.flag === "short").length };
}
