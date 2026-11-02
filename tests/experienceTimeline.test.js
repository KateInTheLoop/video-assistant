import { test } from "node:test";
import assert from "node:assert/strict";
import { experienceQuestion, topicMatches, topicTimeline, experienceDuration } from "../lib/experienceTimeline.js";

const role = (title, from, to, highlights = []) => ({ title, employer: "Example Co", from, to, dates: `${from} – ${to}`, highlights });
const direct = (value) => ({ role: value, direct: true });
const asOf = new Date("2026-11-01T00:00:00Z");

test("detects personal topic narratives and duration questions without swallowing definitions", () => {
  for (const question of ["Tell me about your experience with Oracle Fusion?", "What is your experience in inventory reconciliations?", "Walk me through your work experience with NetSuite", "Describe your experience using SQL."]) {
    const result = experienceQuestion(question);
    assert.ok(result, question);
    assert.equal(result.asksDuration, false);
  }
  assert.deepEqual(experienceQuestion("How many years of experience do you have with Workday?"), { topic: "Workday", asksDuration: true });
  assert.deepEqual(experienceQuestion("How long have you worked with Oracle Fusion?"), { topic: "Oracle Fusion", asksDuration: true });
  assert.deepEqual(experienceQuestion("How many years have you used NetSuite?"), { topic: "NetSuite", asksDuration: true });
  assert.deepEqual(experienceQuestion("How many years of SQL experience do you have?"), { topic: "SQL", asksDuration: true });
  assert.deepEqual(experienceQuestion("How many years of experience with NetSuite do you have?"), { topic: "NetSuite", asksDuration: true });
  assert.deepEqual(experienceQuestion("Tell me about your experience working with Workday, and how did you use it?"), { topic: "Workday", asksDuration: false });
  for (const question of ["Walk me through your resume", "What is Oracle Fusion?", "How do you reconcile an account?", "And with NetSuite?", "Tell me about your experience with this?"]) assert.equal(experienceQuestion(question), null, question);
});

test("literal topic matching is conservative and preserves technical punctuation", () => {
  assert.equal(topicMatches("Owned accounts payable reconciliations", "account payable reconciliation"), true);
  assert.equal(topicMatches("Used Oracle EBS", "Oracle Fusion"), false);
  assert.equal(topicMatches("Developed in C", "C++"), false);
  assert.equal(topicMatches("Used C++ and .NET", "C++"), true);
  assert.equal(topicMatches("Worked on JavaScript", "Java"), false);
  assert.equal(topicMatches("Implementation testing", "the and with"), false);
  assert.equal(topicMatches("No direct experience with Oracle", "Oracle"), false);
  assert.equal(topicMatches("Never used Oracle", "Oracle"), false);
  assert.equal(topicMatches("No SQL experience", "SQL"), false);
  assert.equal(topicMatches("Did not use SQL", "SQL"), false);
  assert.equal(topicMatches("No exposure to Workday", "Workday"), false);
  assert.equal(topicMatches("Used Oracle with no prior experience", "Oracle"), true);
  assert.equal(topicMatches("Not only Oracle but other systems", "Oracle"), true);
});

test("all directly matching roles survive without a three-story cap and remain chronological", () => {
  const roles = Array.from({ length: 5 }, (_, i) => role(`Engineer ${i}`, `January ${2010 + i}`, `December ${2010 + i}`, ["Used SQL for reporting"]));
  const entries = topicTimeline(roles, "SQL");
  assert.equal(entries.length, 5);
  assert.deepEqual(entries.map(e => e.roleIndex), [1, 2, 3, 4, 5]);
  assert.equal(entries.every(e => e.direct), true);
  assert.deepEqual(entries[0].quotes, ["Used SQL for reporting"]);
});

test("mixed positive and denied tools are scoped by clause for matching, quotes and duration", () => {
  for (const text of [
    "Used SQL; never used Workday",
    "Used SQL, never used Workday",
    "Used SQL, but never used Workday",
    "Used SQL, and never used Workday",
    "Used SQL and never used Workday",
    "Used SQL but did not use Workday",
    "Used SQL and not Workday",
    "Used SQL; no exposure to Workday",
    "Never used Workday and used SQL",
  ]) {
    assert.equal(topicMatches(text, "SQL"), true, text);
    assert.equal(topicMatches(text, "Workday"), false, text);
    const roles = [role("Analyst", "January 2020", "December 2021", [text])];
    const denied = topicTimeline(roles, "Workday", [{ role: 1, quote: "Workday" }, { role: 1, quote: text }]);
    assert.deepEqual(denied, [], text);
    assert.equal(experienceDuration(denied, asOf).months, null, text);
    const positive = topicTimeline(roles, "SQL", [{ role: 1, quote: "SQL" }]);
    assert.equal(positive.length, 1, text);
    assert.equal(positive[0].direct, true, text);
    assert.equal(experienceDuration(positive, asOf).months, 24, text);
    assert.equal(positive[0].quotes.some(quote => /Workday/.test(quote)), false, text);
  }
  assert.equal(topicMatches("Used SQL despite no prior experience", "SQL"), true);
  assert.equal(topicMatches("Used SQL with no prior experience with Workday", "SQL"), true);
  assert.equal(topicMatches("Used SQL with no prior experience with Workday", "Workday"), false);
});

test("model associations require valid CV role indices and exact source anchoring", () => {
  const roles = [role("Analyst", "January 2015", "December 2016", ["Coordinated UAT testing"]), role("Engineer", "January 2017", "December 2018", ["Used Oracle Fusion"]), role("Support", "January 2019", "December 2020", ["Answered requests"])];
  const entries = topicTimeline(roles, "ERP implementations", [
    { role: 1, quote: "UAT testing" }, { role: 1, quote: "UAT testing" },
    { role: 2, quote: "Invented migration ownership" }, { role: 3, quote: "Example Co" },
    { role: 0, quote: "Used Oracle Fusion" }, { role: 20, quote: "Answered requests" },
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].roleIndex, 1);
  assert.equal(entries[0].direct, false);
  assert.deepEqual(entries[0].quotes, ["UAT testing"]);
  assert.equal(experienceDuration(entries, asOf).months, null);
  assert.equal(experienceDuration(entries, asOf).omittedRoles, 1);
  assert.deepEqual(topicTimeline([role("Analyst", "January 2020", "December 2021", ["No SQL experience", "Did not use SQL"])], "SQL", [{ role: 1, quote: "SQL" }]), []);
});

test("duration unions overlapping monthly windows and excludes gaps", () => {
  const entries = [direct(role("A", "January 2020", "December 2021")), direct(role("B", "July 2021", "June 2022")), direct(role("C", "January 2024", "December 2024"))];
  const result = experienceDuration(entries, asOf);
  assert.equal(result.months, 42);
  assert.equal(result.intervals.length, 2);
  assert.equal(result.roleCount, 3);
  assert.match(result.label, /Up to 3 years 6 months/);
  assert.match(result.caveat, /do not confirm continuous use/);
  assert.equal(result.uncertain, false);
});

test("present ends at the supplied date and future/invalid/reversed roles are excluded", () => {
  const result = experienceDuration([
    direct(role("Current", "January 2024", "Present")),
    direct(role("Future", "January 2030", "December 2031")),
    direct(role("Reversed", "December 2025", "January 2024")),
    direct(role("Unknown", "Unknown", "Present")),
  ], asOf);
  assert.equal(result.months, 34);
  assert.equal(result.omittedRoles, 3);
  assert.equal(result.intervals[0].to, "2026-11-01");
  assert.equal(experienceDuration([direct(role("Current", "January 2026", "Present"))], new Date("2026-02-15T00:00:00Z")).months, 2);
  assert.equal(experienceDuration([direct(role("Current", "January 2026", "Present"))], new Date("2026-02-15T00:00:00Z")).intervals[0].to, "2026-02-15");
});

test("year-only dates expose uncertainty and are never described as confirmed skill tenure", () => {
  const result = experienceDuration([direct(role("Analyst", "2019", "2021"))], asOf);
  assert.equal(result.months, 36);
  assert.equal(result.uncertain, true);
  assert.match(result.label, /approximate dates/);
  assert.match(result.caveat, /Confirm actual topic tenure/);
  assert.equal(experienceDuration([], asOf).months, null);
});
