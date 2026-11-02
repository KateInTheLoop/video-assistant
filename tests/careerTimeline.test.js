import { test } from "node:test";
import assert from "node:assert/strict";
import { careerTimeline, isCareerWalkthrough, routeCareerHint } from "../lib/careerTimeline.js";

// Synthetic CV only: mirrors layout, dates and continuation lines without personal data.
const syntheticCv = `EXAMPLE CANDIDATE
PROFESSIONAL EXPERIENCE
Product Consultant June 2025– present
Example Studio, Riverton
- Product discovery workshops
- Release planning support
Release Lead February 2021 – May 2025
Example Product Team, Riverton
- Coordinated release checks
Integration Engineer October 2018 – January 2021
Example Devices, Riverton
- Tested device integrations
- Maintained build pipelines
Platform Engineer April 2016 – September 2018
Example Hosting, Greenfield
- Maintained test environments
Platform Engineer July 2013 – March 2016
Example Software, Greenfield
- Investigated deployment failures
- Supported a platform migration with
an engineering team
Support Engineer February 2010 - June 2013
Example Networks, Lakeside
- Customer issue triage
Lab Technician August 2007 - January 2010
Example Research Lab, Hilltown
- Maintained laboratory equipment
EDUCATION
Example University 2003 - 2007
SKILLS
Testing tools`;

test("all seven roles appear oldest to newest, with exact CV facts and no education entries", () => {
  const roles = careerTimeline(syntheticCv);
  assert.equal(roles.length, 7);
  assert.equal(roles[0].title, "Lab Technician");
  assert.equal(roles[0].from, "August 2007");
  assert.equal(roles[6].title, "Product Consultant");
  assert.equal(roles[6].to, "present");
  assert.equal(roles[1].employer, "Example Networks, Lakeside");
  assert.equal(roles[2].highlights[1], "Supported a platform migration with an engineering team");
  assert.equal(roles.filter(r => r.title === "Platform Engineer").length, 2, "same title at different employers is not deduplicated");
});

test("handles separate date lines, abbreviated dates, years-only ranges and no section headings", () => {
  const roles = careerTimeline("Recent Role\nJan. 2022—Present\nExample Co\n- Recent work\nEarlier Role 2010 to 2012\nExample Ltd\n- Earlier work");
  assert.equal(roles.length, 2);
  assert.equal(roles[0].title, "Earlier Role");
  assert.equal(roles[1].employer, "Example Co");
  assert.deepEqual(careerTimeline("No dated experience here"), []);
});

test("explicit resume questions route to a career walkthrough, not a story shortlist", () => {
  for (const text of ["Can you walk me through your resume?", "Walk us through your CV", "Give an overview of your career", "Take me through your professional experience", "Tell me about yourself", "Tell us about your background?", "Tell me about your resume", "Describe your career.", "Tell me a little bit about yourself.", "Tell me about yourself, please.", "Please introduce yourself."]) assert.equal(isCareerWalkthrough(text), true, text);
  for (const text of ["Walk me through a bank reconciliation", "What is debit versus credit?", "Tell me about a conflict", "Tell me about your background with SQL", "Tell me about a time you introduced yourself"]) assert.equal(isCareerWalkthrough(text), false, text);
  const routed = routeCareerHint({ is_question: true, question_type: "experience", stories: [{ title: "One story" }] }, "Walk me through your resume");
  assert.equal(routed.question_type, "career_walkthrough");
  assert.deepEqual(routed.stories, []);
});
