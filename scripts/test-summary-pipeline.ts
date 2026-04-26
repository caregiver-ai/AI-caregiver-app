import assert from "node:assert/strict";
import { normalizeAuthoritativeStructuredSummary } from "../lib/summary";
import { expandTurnsForSummaryCapture } from "../lib/summary-generation";
import { StructuredSummary } from "../lib/types";

function emptySummary(): StructuredSummary {
  return {
    title: "Caring for Gavin",
    overview: "",
    generatedAt: "",
    pipelineVersion: "",
    layoutVersion: "",
    sourceTurnsHash: "",
    sections: [
      { id: "communication-1", title: "Communication", items: ["(No information provided)"] },
      { id: "daily-needs-routines-2", title: "Daily Needs & Routines", items: ["(No information provided)"] },
      { id: "what-helps-the-day-go-well-3", title: "What helps the day go well", items: ["(No information provided)"] },
      { id: "what-can-upset-or-overwhelm-them-4", title: "What can upset or overwhelm them", items: ["(No information provided)"] },
      { id: "signs-they-need-help-5", title: "Signs they need help", items: ["(No information provided)"] },
      {
        id: "what-helps-when-they-are-having-a-hard-time-6",
        title: "What helps when they are having a hard time",
        items: ["(No information provided)"]
      },
      { id: "health-safety-7", title: "Health & Safety", items: ["(No information provided)"] },
      { id: "who-to-contact-and-when-8", title: "Who to contact (and when)", items: ["(No information provided)"] }
    ]
  };
}

function sectionItems(summary: StructuredSummary, title: string) {
  return summary.sections.find((section) => section.title === title)?.items ?? [];
}

function sectionText(summary: StructuredSummary, title: string) {
  return sectionItems(summary, title).join("\n");
}

function testAuthoritativePlacement() {
  const summary = emptySummary();
  summary.sections = summary.sections.map((section) => {
    if (section.title === "Communication") {
      return {
        ...section,
        items: [
          "He uses TouchChat on an iPad to ask for help.",
          "TouchChat AAC on iPad.",
          "If he is limping, it may mean he is not feeling well.",
          "Bowel movements happen in his pull-up."
        ]
      };
    }

    if (section.title === "Signs they need help") {
      return {
        ...section,
        items: [
          "He may press help on his AAC device.",
          "Abilify (Aripiprazole) 15 mg is given once daily at 3 p.m."
        ]
      };
    }

    return section;
  });

  const normalized = normalizeAuthoritativeStructuredSummary(summary, "Gavin");

  assert.match(sectionText(normalized, "Communication"), /TouchChat/i);
  assert.doesNotMatch(sectionText(normalized, "Communication"), /limping/i);
  assert.doesNotMatch(sectionText(normalized, "Communication"), /pull-up/i);
  assert.doesNotMatch(sectionText(normalized, "Signs they need help"), /Abilify|Aripiprazole/i);
  assert.match(sectionText(normalized, "Signs they need help"), /limping/i);
  assert.match(sectionText(normalized, "Daily Needs & Routines"), /pull-up/i);
  assert.match(sectionText(normalized, "Health & Safety"), /Abilify|Aripiprazole/i);
}

function testHardTimeDedupes() {
  const summary = emptySummary();
  summary.sections = summary.sections.map((section) =>
    section.title === "What helps when they are having a hard time"
      ? {
          ...section,
          items: [
            "Do not physically stop him from biting his hand because he may bite you.",
            "Do not block hand biting (he may bite you).",
            "Give him space immediately.",
            "Reduce stimulation and keep things quiet.",
            "Give him space, reduce stimulation, and keep the environment quiet while redirecting and maintaining safety."
          ]
        }
      : section
  );

  const normalized = normalizeAuthoritativeStructuredSummary(summary, "Gavin");
  const items = sectionItems(normalized, "What helps when they are having a hard time");
  const handBitingItems = normalized.sections
    .flatMap((section) => section.items)
    .filter((item) => /bite you|hand biting/i.test(item));
  const spaceItems = items.filter((item) => /space|quiet|stimulation/i.test(item));

  assert.equal(handBitingItems.length, 1);
  assert.ok(spaceItems.length <= 1);
}

function testPreferenceCondensing() {
  const summary = emptySummary();
  summary.sections = summary.sections.map((section) =>
    section.title === "What helps the day go well"
      ? {
          ...section,
          items: [
            "He likes farms.",
            "He likes animals.",
            "He likes dinosaurs.",
            "He likes cars.",
            "He likes trucks.",
            "He likes books.",
            "He likes planets."
          ]
        }
      : section
  );

  const normalized = normalizeAuthoritativeStructuredSummary(summary, "Gavin");
  const text = sectionText(normalized, "What helps the day go well");

  assert.match(text, /Preferred activities include/i);
  assert.doesNotMatch(text, /He likes farms\./i);
  assert.ok(sectionItems(normalized, "What helps the day go well").length <= 2);
}

function testNoInventedSupports() {
  const summary = emptySummary();
  summary.sections = summary.sections.map((section) =>
    section.title === "Communication"
      ? {
          ...section,
          items: ["He uses TouchChat on an iPad to communicate."]
        }
      : section
  );

  const normalized = normalizeAuthoritativeStructuredSummary(summary, "Gavin");

  assert.doesNotMatch(
    sectionText(normalized, "What helps the day go well"),
    /prevent frustration|search history|iPad/i
  );
}

function testRawInputParser() {
  const turns = expandTurnsForSummaryCapture([
    {
      id: "raw-1",
      role: "user",
      promptType: "section_prompt",
      content: `Communication
How do they communicate?
Gavin is non-speaking and uses AAC.

What helps you communicate with them?
Visual supports and 2-step directions help.

Signs They May Need Help
What changes in their behavior show they need help?
He may run away or bite his hand.

Who To Contact
Who should be contacted in an emergency?
Rania Kelly, 617-538-4056.`,
      createdAt: "2026-04-26T12:00:00.000Z",
      promptLabel: "Raw input"
    }
  ]);

  assert.equal(turns.length, 4);
  assert.equal(turns[0]?.promptLabel, "How do they communicate?");
  assert.equal(turns[0]?.sectionTitle, "Communication");
  assert.match(turns[0]?.content ?? "", /non-speaking/i);
  assert.equal(turns[2]?.stepTitle, "Signs They May Need Help");
  assert.equal(turns[2]?.promptLabel, "What changes in their behavior show they need help?");
  assert.match(turns[2]?.content ?? "", /run away|bite his hand/i);
  assert.equal(turns[3]?.sectionTitle, "Who to contact (and when)");
}

function testAmPmFormatting() {
  const summary = emptySummary();
  summary.sections = summary.sections.map((section) =>
    section.title === "Daily Needs & Routines"
      ? {
          ...section,
          items: ["On school days, Gavin wakes around 7:20 a.m.", "The van usually comes around 8:05 p.m."]
        }
      : section
  );

  const normalized = normalizeAuthoritativeStructuredSummary(summary, "Gavin");
  const text = sectionText(normalized, "Daily Needs & Routines");

  assert.match(text, /7:20 a\.m\./i);
  assert.match(text, /8:05 p\.m\./i);
}

testAuthoritativePlacement();
testHardTimeDedupes();
testPreferenceCondensing();
testNoInventedSupports();
testRawInputParser();
testAmPmFormatting();

console.log("summary pipeline tests passed");
