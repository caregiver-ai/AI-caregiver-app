import assert from "node:assert/strict";
import {
  getOverviewLines,
  normalizeAuthoritativeStructuredSummary,
  normalizeEditableStructuredSummary
} from "../lib/summary";
import { finalizeSummaryWithQa } from "../lib/summary-audit";
import {
  SummaryModelRequestError,
  __summaryGenerationTestUtils,
  expandTurnsForSummaryCapture
} from "../lib/summary-generation";
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

function testStructuredOverview() {
  const summary = emptySummary();
  summary.sections = summary.sections.map((section) => {
    if (section.title === "Communication") {
      return {
        ...section,
        items: ["Gavin is non-speaking.", "He uses TouchChat on an iPad to ask for help."]
      };
    }

    if (section.title === "Daily Needs & Routines") {
      return {
        ...section,
        items: ["He needs food often.", "Give regular bathroom reminders."]
      };
    }

    if (section.title === "What helps the day go well") {
      return {
        ...section,
        items: ["He is very visual.", "He does best with 2-step directions."]
      };
    }

    if (section.title === "Signs they need help") {
      return {
        ...section,
        items: ["Running away or elopement is a sign he needs help.", "Hand biting is a sign he needs help."]
      };
    }

    if (section.title === "Health & Safety") {
      return {
        ...section,
        items: ["Pica.", "Outings such as walks or car rides require at least two caregivers for safety."]
      };
    }

    if (section.title === "Who to contact (and when)") {
      return {
        ...section,
        items: ["Contact Rania Kelly at (617) 538-4056."]
      };
    }

    return section;
  });

  const normalized = normalizeAuthoritativeStructuredSummary(summary, "Gavin");
  const overviewLines = getOverviewLines(normalized.overview);

  assert.equal(overviewLines.length, 5);
  assert.match(overviewLines[0] ?? "", /^Communication:\s+Non-speaking, uses AAC \(TouchChat on iPad\)$/i);
  assert.match(overviewLines[1] ?? "", /^Key Needs:\s+/i);
  assert.match(overviewLines[2] ?? "", /^Top Risks:\s+/i);
  assert.match(overviewLines[3] ?? "", /^Best Supports:\s+/i);
  assert.match(overviewLines[4] ?? "", /^Emergency Contact:\s+Rania Kelly \(\(617\) 538-4056\)$/i);
}

function testPreferredStructuredBlocksUseAuthoritativeCleanup() {
  const summary = emptySummary();
  summary.overview =
    "Gavin is non-speaking and communicates using AAC device, sounds, and behavior cues. Gavin requires close supervision due to safety risks including self-injury.";
  summary.sections = [
    {
      id: "communication-1",
      title: "Communication",
      items: [],
      blocks: [
        {
          type: "bullets",
          items: [
            "Gavin is non-speaking and communicates with sounds, body language, and AAC.",
            "He uses TouchChat on an iPad to ask for help and label what he wants."
          ]
        }
      ]
    },
    {
      id: "daily-needs-routines-2",
      title: "Daily Needs & Routines",
      items: [],
      blocks: [
        {
          type: "bullets",
          items: [
            "On school days, Gavin wakes around 7:20 a.",
            "A visual timer and visual schedule with a preferred item or activity at the end are helpful."
          ]
        }
      ]
    },
    {
      id: "what-helps-the-day-go-well-3",
      title: "What helps the day go well",
      items: [],
      blocks: [
        {
          type: "bullets",
          items: [
            "Regular access to food helps prevent distress.",
            "Structured routine helps him stay regulated.",
            "Mom is his favorite person.",
            "He also enjoys spending time with family.",
            "Downtime usually means being left alone to do his own thing."
          ]
        }
      ]
    },
    {
      id: "what-can-upset-or-overwhelm-them-4",
      title: "What can upset or overwhelm them",
      items: [],
      blocks: [{ type: "bullets", items: ["Overhead lighting is upsetting, so the home uses soft indirect lighting."] }]
    },
    {
      id: "signs-they-need-help-5",
      title: "Signs they need help",
      items: [],
      blocks: [
        {
          type: "bullets",
          items: [
            "Abilify (Aripiprazole) 15 mg once daily at 3pm for irritability, aggression, repetitive behaviors, and self-injury.",
            "Limping, avoiding a body part, not eating, not drinking, and unusual lethargy or low energy."
          ]
        }
      ]
    },
    {
      id: "what-helps-when-they-are-having-a-hard-time-6",
      title: "What helps when they are having a hard time",
      items: [],
      blocks: [{ type: "bullets", items: ["Give him space, reduce stimulation, and keep things quiet."] }]
    },
    {
      id: "health-safety-7",
      title: "Health & Safety",
      items: [],
      blocks: [{ type: "bullets", items: ["Pica.", "Outings such as walks or car rides require at least two caregivers for safety."] }]
    },
    {
      id: "who-to-contact-and-when-8",
      title: "Who to contact (and when)",
      items: [],
      blocks: [{ type: "bullets", items: ["Rania Kelly, Mother with physical custody, 617-538-4056."] }]
    }
  ];

  const normalized = normalizeAuthoritativeStructuredSummary(summary, "Gavin");
  const overviewLines = getOverviewLines(normalized.overview);
  const dayGoWellText = sectionText(normalized, "What helps the day go well");
  const signsText = sectionText(normalized, "Signs they need help");
  const healthText = sectionText(normalized, "Health & Safety");
  const dailyText = sectionText(normalized, "Daily Needs & Routines");

  assert.equal(overviewLines.length, 5);
  assert.match(overviewLines[0] ?? "", /^Communication:\s+/i);
  assert.doesNotMatch(signsText, /Abilify|Aripiprazole/i);
  assert.match(healthText, /Abilify|Aripiprazole/i);
  assert.match(dailyText, /7:20 a\.m\./i);
  assert.match(dayGoWellText, /structured routine|visual timer|visual schedule|regular access to food/i);
  assert.doesNotMatch(dayGoWellText, /favorite person|spending time with family|downtime/i);
}

function testQaReportWarnsForEditedSummaryWithoutRewritingCards() {
  const summary = emptySummary();
  summary.overview =
    "Gavin is non-speaking and communicates using AAC device, sounds, and behavior cues. Gavin requires close supervision due to safety risks including self-injury.";
  summary.sections = summary.sections.map((section) => {
    if (section.title === "Signs they need help") {
      return {
        ...section,
        items: [
          "Abilify (Aripiprazole) 15 mg once daily at 3pm for irritability, aggression, repetitive behaviors, and self-injury.",
          "Limping, avoiding a body part, not eating, not drinking, and unusual lethargy or low energy."
        ]
      };
    }

    if (section.title === "What helps the day go well") {
      return {
        ...section,
        items: [
          "Regular access to food helps prevent distress.",
          "Structured routine helps him stay regulated.",
          "Mom is his favorite person.",
          "He also enjoys spending time with family."
        ]
      };
    }

    if (section.title === "Who to contact (and when)") {
      return {
        ...section,
        items: ["Rania Kelly, Mother with physical custody, 617-538-4056."]
      };
    }

    return section;
  });

  const normalized = normalizeEditableStructuredSummary(summary, "Gavin");
  const { summary: qaSummary, report } = finalizeSummaryWithQa(normalized, { source: "edited" });

  assert.equal(report.status, "warn");
  assert.match(report.issues.map((issue) => issue.message).join("\n"), /Health & Safety/i);
  assert.match(sectionText(qaSummary, "Signs they need help"), /Abilify|Aripiprazole/i);
  assert.equal(getOverviewLines(qaSummary.overview).length, 5);
}

function testSavedSummaryQaRebuildsOverviewAndWarns() {
  const summary = emptySummary();
  summary.overview =
    "Gavin is non-speaking and communicates using AAC device, sounds, and behavior cues. Gavin requires close supervision due to safety risks including self-injury.";
  summary.sections = summary.sections.map((section) =>
    section.title === "What helps the day go well"
      ? {
          ...section,
          items: ["Structured routine helps him stay regulated.", "Downtime usually means being left alone to do his own thing."]
        }
      : section.title === "Who to contact (and when)"
        ? {
            ...section,
            items: ["Contact Rania Kelly at (617) 538-4056."]
          }
        : section.title === "Communication"
          ? {
              ...section,
              items: ["Gavin is non-speaking.", "He uses TouchChat on an iPad to ask for help."]
            }
          : section
  );

  const { summary: qaSummary, report } = finalizeSummaryWithQa(summary, { source: "saved" });

  assert.equal(getOverviewLines(qaSummary.overview).length, 5);
  assert.equal(report.status, "pass");
  assert.doesNotMatch(sectionText(qaSummary, "What helps the day go well"), /Downtime/i);
  assert.match(sectionText(qaSummary, "What helps the day go well"), /structured routine/i);
}

function testSavedSummaryQaRepairsMedicationPlacement() {
  const summary = emptySummary();
  summary.sections = summary.sections.map((section) =>
    section.title === "Signs they need help"
      ? {
          ...section,
          items: ["Abilify (Aripiprazole) 15 mg once daily at 3pm for irritability, aggression, repetitive behaviors, and self-injury."]
        }
      : section
  );

  const { summary: qaSummary, report } = finalizeSummaryWithQa(summary, { source: "saved" });

  assert.equal(report.status, "pass");
  assert.doesNotMatch(sectionText(qaSummary, "Signs they need help"), /Abilify|Aripiprazole/i);
  assert.match(sectionText(qaSummary, "Health & Safety"), /Abilify|Aripiprazole/i);
}

function testStructuredJsonRecoveryUtilities() {
  const fenced = `\`\`\`json
{"facts":[{"entryId":"Entry 1","section":"Communication","factKind":"communication_method","statement":"Gavin is non-speaking.","safetyRelevant":false}]}
\`\`\``;
  const parsed = __summaryGenerationTestUtils.parseStructuredJson<{
    facts: Array<{ statement: string }>;
  }>(fenced);

  assert.equal(parsed?.facts[0]?.statement, "Gavin is non-speaking.");
  assert.equal(
    __summaryGenerationTestUtils.looksLikeTruncatedStructuredOutput(
      '{"facts":[{"entryId":"Entry 1","section":"Communication","factKind":"communication_method"'
    ),
    true
  );
  assert.equal(
    __summaryGenerationTestUtils.looksLikeTruncatedStructuredOutput('{"facts":[]}'),
    false
  );
}

async function testSingleEntryCaptureTruncationRetry() {
  const entry = __summaryGenerationTestUtils.createSummarySourceEntry(
    {
      sectionTitle: "Communication",
      stepId: "communication",
      stepTitle: "Communication",
      promptLabel: "How do they communicate?"
    },
    "Entry 1",
    "Gavin is non-speaking. He uses AAC on an iPad. He presses help on his device.",
    {
      internalEntryId: "entry-1",
      splitDepth: 0,
      splitStrategy: "entry"
    }
  );
  const entryMetadata = new Map([["Entry 1", entry]]);
  const diagnostics: string[] = [];
  const chunkRequests: string[] = [];
  let firstAttempt = true;

  const facts = await __summaryGenerationTestUtils.captureChunkWithRetry(
    [entry],
    async (chunk: string) => {
      chunkRequests.push(chunk);

      if (firstAttempt) {
        firstAttempt = false;
        throw new SummaryModelRequestError(
          'Summary generation returned invalid structured JSON because the model output was truncated. Raw model output: {"facts":[{"entryId":"Entry 1","section":"Communication","factKind":"communication_method","statement":"Gavin is non-speaking."',
          {
            kind: "truncation"
          }
        );
      }

      const chunkFacts: Array<{
        entryId: string;
        section: "Communication";
        factKind: "communication_method" | "communication_signal";
        statement: string;
        safetyRelevant: boolean;
      }> = [];
      if (/non-speaking/i.test(chunk)) {
        chunkFacts.push({
          entryId: "Entry 1",
          section: "Communication",
          factKind: "communication_method",
          statement: "Gavin is non-speaking.",
          safetyRelevant: false
        });
      }
      if (/uses AAC/i.test(chunk)) {
        chunkFacts.push({
          entryId: "Entry 1",
          section: "Communication",
          factKind: "communication_method",
          statement: "He uses AAC on an iPad.",
          safetyRelevant: false
        });
      }
      if (/presses help/i.test(chunk)) {
        chunkFacts.push({
          entryId: "Entry 1",
          section: "Communication",
          factKind: "communication_signal",
          statement: "He presses help on his device.",
          safetyRelevant: false
        });
      }

      return { facts: chunkFacts };
    },
    entryMetadata,
    diagnostics
  );

  assert.ok(chunkRequests.length >= 3);
  assert.ok(
    diagnostics.some((line) => /strategy=(paragraph|sentence|chars)/.test(line)),
    diagnostics.join("\n")
  );
  assert.match(facts.map((fact) => fact.statement).join("\n"), /non-speaking/i);
  assert.match(facts.map((fact) => fact.statement).join("\n"), /presses help/i);
}

async function main() {
  testAuthoritativePlacement();
  testHardTimeDedupes();
  testPreferenceCondensing();
  testNoInventedSupports();
  testRawInputParser();
  testAmPmFormatting();
  testStructuredOverview();
  testPreferredStructuredBlocksUseAuthoritativeCleanup();
  testQaReportWarnsForEditedSummaryWithoutRewritingCards();
  testSavedSummaryQaRebuildsOverviewAndWarns();
  testSavedSummaryQaRepairsMedicationPlacement();
  testStructuredJsonRecoveryUtilities();
  await testSingleEntryCaptureTruncationRetry();

  console.log("summary pipeline tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
