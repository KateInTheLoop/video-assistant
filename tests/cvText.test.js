import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCvText, docxXmlToText, odtXmlToText, cvFileKind, unsupportedCvMessage, MAX_CV_CHARS } from "../lib/cvText.js";

test("normalize collapses whitespace, blank runs and bullet glyphs", () => {
  const raw = "Jane Doe\r\n\r\n\r\n•  Owned month-end close   \n● Built accrual schedule\n\n\n\nSkills:\tExcel";
  assert.equal(normalizeCvText(raw), "Jane Doe\n\n- Owned month-end close\n- Built accrual schedule\n\nSkills: Excel");
});

test("normalize drops running headers/footers repeated across pages", () => {
  const page = (n) => `jane@example.com | +44 7700 900000\nContent of page ${n}\nPage ${n} of 3`;
  const out = normalizeCvText([page(1), page(2), page(3)].join("\n"));
  assert.equal(out.split("jane@example.com").length - 1, 1, "email kept once");
  assert.equal(/Page \d+ of 3/.test(out), false, "page numbers gone");
  assert.ok(out.includes("Content of page 2"));
});

test("normalize truncates a very long CV with a marker", () => {
  const out = normalizeCvText("x".repeat(MAX_CV_CHARS + 500));
  assert.ok(out.length < MAX_CV_CHARS + 100);
  assert.match(out, /CV truncated/);
});

test("docx xml: paragraphs, tabs, breaks, entities and list items", () => {
  const xml = `<w:document><w:body>
    <w:p><w:r><w:t>Jane </w:t></w:r><w:r><w:t xml:space="preserve">Doe</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Cut close from 9</w:t></w:r><w:r><w:tab/><w:t>to 5 days</w:t></w:r></w:p>
    <w:p><w:r><w:t>R&amp;D &lt;team&gt;</w:t><w:br/><w:t>second line</w:t></w:r></w:p>
    <w:p><w:pPr></w:pPr></w:p>
    <w:p><w:r><w:t>after a blank</w:t></w:r></w:p>
  </w:body></w:document>`;
  assert.equal(docxXmlToText(xml), "Jane Doe\n- Cut close from 9\tto 5 days\nR&D <team>\nsecond line\n\nafter a blank");
});

test("file kind is decided by extension, case-insensitively", () => {
  assert.equal(cvFileKind("CV.PDF"), "pdf");
  assert.equal(cvFileKind("resume.docx"), "docx");
  assert.equal(cvFileKind("notes.md"), "text");
  assert.equal(cvFileKind("cv.txt"), "text");
  assert.equal(cvFileKind("cv.odt"), "odt");
  assert.equal(cvFileKind("old.doc"), "doc-legacy");
  assert.equal(cvFileKind("cv.rtf"), "unsupported-reexport");
  assert.equal(cvFileKind("photo.png"), "unsupported");
});

test("odt xml: headings, paragraphs, tabs, spaces, breaks, list items, annotations dropped", () => {
  const xml = `<office:document-content><office:body><office:text>
    <text:h text:outline-level="1">Jane Doe</text:h>
    <text:p>Senior<text:s text:c="2"/>Accountant<text:tab/>London</text:p>
    <text:list><text:list-item><text:p>Cut close<text:line-break/>9 to 5 days</text:p></text:list-item></text:list>
    <text:p>R&amp;D<office:annotation><text:p>ignore me</text:p></office:annotation> team</text:p>
    <text:p text:style-name="Standard"/>
    <text:p>after a blank</text:p>
  </office:text></office:body></office:document-content>`;
  assert.equal(odtXmlToText(xml), "Jane Doe\nSenior  Accountant\tLondon\n- Cut close\n9 to 5 days\nR&D team\n\nafter a blank");
});

test("unsupported files get a message that says what to do instead", () => {
  assert.match(unsupportedCvMessage("cv.doc"), /Save As.*\.docx/);
  assert.match(unsupportedCvMessage("cv.doc"), /Google Docs/);
  assert.match(unsupportedCvMessage("cv.rtf"), /PDF or \.docx/);
  assert.match(unsupportedCvMessage("cv.png"), /PDF, DOCX, ODT, TXT or MD/);
});
