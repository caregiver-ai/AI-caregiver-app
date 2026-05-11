import assert from "node:assert/strict";
import {
  getOverviewLines,
  normalizeAuthoritativeStructuredSummary,
  normalizeEditableStructuredSummary
} from "../lib/summary";
import {
  collectRepairHintsFromAuditReport,
  finalizeSummaryWithQa,
  summarizeSummaryAuditReport
} from "../lib/summary-audit";
import {
  SummaryModelRequestError,
  __summaryGenerationTestUtils,
  expandTurnsForSummaryCapture
} from "../lib/summary-generation";
import { StructuredSummary, StructuredSummaryFact, SummaryAuditReport } from "../lib/types";

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
  assert.match(overviewLines[0] ?? "", /^Communication:\s+/i);
  assert.match(overviewLines[0] ?? "", /TouchChat|AAC|iPad/i);
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

function testSavedSummaryQaAllowsConciseSupportAndTriggerBullets() {
  const summary = emptySummary();
  summary.sections = summary.sections.map((section) =>
    section.title === "What helps the day go well"
      ? {
          ...section,
          items: ["He enjoys walks and car rides."]
        }
      : section.title === "What can upset or overwhelm them"
        ? {
            ...section,
            items: ["Too many people can feel overwhelming."]
          }
        : section
  );

  const { report } = finalizeSummaryWithQa(summary, { source: "saved" });

  assert.doesNotMatch(
    report.issues.map((issue) => issue.message).join("\n"),
    /walks and car rides|Too many people can feel overwhelming/i
  );
}

function testSavedSummaryQaStillWarnsOnLongPreferenceInventory() {
  const summary = emptySummary();
  summary.sections = summary.sections.map((section) =>
    section.title === "What helps the day go well"
      ? {
          ...section,
          items: [
            "He also enjoys books, animals, farms, dinosaurs, cars, trucks, YouTube, drums, guitar, piano, sensory toys, and sweets."
          ]
        }
      : section
  );

  const { report } = finalizeSummaryWithQa(summary, { source: "saved" });

  assert.match(
    report.issues.map((issue) => issue.message).join("\n"),
    /low-signal or awkward bullet/i
  );
  assert.equal(report.userStatus, "pass");
  assert.equal(report.userVisibleIssues.length, 0);
}

function testAuditClassificationAndUserFiltering() {
  const summary = emptySummary();
  const report = finalizeSummaryWithQa(summary, {
    source: "saved",
    issues: [
      {
        code: "missing_coverage",
        message: "entry-1-fact-1 is missing from Health & Safety: Keep meds locked.",
        factId: "entry-1-fact-1",
        expectedSection: "Health & Safety"
      },
      {
        code: "missing_coverage",
        message: "entry-1-fact-2 is missing from Communication: He gets close for attention.",
        factId: "entry-1-fact-2",
        expectedSection: "Communication"
      },
      {
        code: "awkward_item",
        message: "What helps the day go well contains a low-signal or awkward bullet: He also enjoys books, animals, and sweets.",
        sectionTitle: "What helps the day go well",
        item: "He also enjoys books, animals, and sweets."
      }
    ]
  }).report;

  const healthIssue = report.issues.find((issue) => issue.factId === "entry-1-fact-1");
  const communicationIssue = report.issues.find((issue) => issue.factId === "entry-1-fact-2");
  const awkwardIssue = report.issues.find((issue) => issue.code === "awkward_item");

  assert.equal(report.status, "warn");
  assert.equal(report.userStatus, "warn");
  assert.equal(report.userVisibleIssues.length, 1);
  assert.equal(healthIssue?.severity, "hard");
  assert.equal(healthIssue?.visibility, "user");
  assert.ok(healthIssue?.userMessage);
  assert.doesNotMatch(healthIssue?.userMessage ?? "", /entry-1-fact-1/i);
  assert.equal(communicationIssue?.severity, "soft");
  assert.equal(communicationIssue?.visibility, "internal");
  assert.equal(awkwardIssue?.severity, "soft");
  assert.equal(awkwardIssue?.visibility, "internal");
  assert.doesNotMatch(
    summarizeSummaryAuditReport(report).join("\n"),
    /entry-1-fact-2|books, animals, and sweets/i
  );
}

function testRepairHintSelectionSkipsSoftCoverageNoise() {
  const report: SummaryAuditReport = {
    status: "warn",
    userStatus: "warn",
    issues: [
      {
        code: "missing_coverage",
        message: "entry-1-fact-1 is missing from Communication: He gets close for attention.",
        factId: "entry-1-fact-1",
        expectedSection: "Communication",
        severity: "soft",
        visibility: "internal"
      },
      {
        code: "awkward_item",
        message: "What helps the day go well contains a low-signal or awkward bullet: He also enjoys books, animals, and sweets.",
        sectionTitle: "What helps the day go well",
        item: "He also enjoys books, animals, and sweets.",
        severity: "soft",
        visibility: "internal"
      },
      {
        code: "missing_coverage",
        message: "entry-1-fact-3 is missing from Health & Safety: Keep medications locked.",
        factId: "entry-1-fact-3",
        expectedSection: "Health & Safety",
        severity: "hard",
        visibility: "user",
        userMessage: "A medication detail may be missing from the summary."
      }
    ],
    userVisibleIssues: [],
    diagnostics: [],
    sectionWarnings: [],
    userSectionWarnings: []
  };

  assert.deepEqual(collectRepairHintsFromAuditReport(report, "soft"), [
    "What helps the day go well contains a low-signal or awkward bullet: He also enjoys books, animals, and sweets."
  ]);
  assert.deepEqual(collectRepairHintsFromAuditReport(report, "hard"), [
    "entry-1-fact-3 is missing from Health & Safety: Keep medications locked."
  ]);
  assert.deepEqual(collectRepairHintsFromAuditReport(report, "all"), [
    "What helps the day go well contains a low-signal or awkward bullet: He also enjoys books, animals, and sweets.",
    "entry-1-fact-3 is missing from Health & Safety: Keep medications locked."
  ]);
}

function testIndexedRepairHintsRouteBySection() {
  const indexed = __summaryGenerationTestUtils.indexRepairHintsBySection([
    "entry-1-fact-3 is missing from Health & Safety: Keep medications locked.",
    "Keep the final summary concise."
  ]);

  assert.deepEqual(indexed.bySection.get("Health & Safety"), [
    "entry-1-fact-3 is missing from Health & Safety: Keep medications locked."
  ]);
  assert.deepEqual(indexed.global, ["Keep the final summary concise."]);
}

function testSectionRepairHintsTargetOnlyImpactedSections() {
  const report: SummaryAuditReport = {
    status: "warn",
    userStatus: "warn",
    issues: [
      {
        code: "section_leakage",
        message:
          "entry-1-fact-7 is only represented in Communication but belongs in Health & Safety.",
        factId: "entry-1-fact-7",
        expectedSection: "Health & Safety",
        actualSection: "Communication",
        severity: "hard",
        visibility: "user",
        userMessage: "A health or safety detail may be in the wrong section and should be reviewed."
      },
      {
        code: "awkward_item",
        message:
          "What helps the day go well contains a low-signal or awkward bullet: He also enjoys books and trucks.",
        sectionTitle: "What helps the day go well",
        item: "He also enjoys books and trucks.",
        severity: "soft",
        visibility: "internal"
      }
    ],
    userVisibleIssues: [],
    diagnostics: [],
    sectionWarnings: [],
    userSectionWarnings: []
  };

  const hardHints = __summaryGenerationTestUtils.collectSectionRepairHints(report, "hard");
  const softHints = __summaryGenerationTestUtils.collectSectionRepairHints(report, "soft");

  assert.deepEqual(hardHints.get("Communication"), [
    "entry-1-fact-7 is only represented in Communication but belongs in Health & Safety."
  ]);
  assert.deepEqual(hardHints.get("Health & Safety"), [
    "entry-1-fact-7 is only represented in Communication but belongs in Health & Safety."
  ]);
  assert.deepEqual(softHints.get("What helps the day go well"), [
    "What helps the day go well contains a low-signal or awkward bullet: He also enjoys books and trucks."
  ]);
  assert.deepEqual(softHints.get("Communication"), []);
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

function testCaptureRetryPrefersLineSplitForListStyleEntries() {
  const entry = __summaryGenerationTestUtils.createSummarySourceEntry(
    {
      sectionTitle: "Daily Needs & Routines",
      stepId: "daily_schedule",
      stepTitle: "Daily Schedule",
      promptLabel: "What routines matter most?"
    },
    "Entry 1",
    "Bathroom every 2 hours\nSnack before school\nWater bottle in van",
    {
      internalEntryId: "entry-1",
      splitDepth: 0,
      splitStrategy: "entry"
    }
  );

  const split = __summaryGenerationTestUtils.splitCaptureEntriesForRetry([entry]);

  assert.equal(split?.strategy, "line");
  assert.equal(split?.chunks.length, 2);
  assert.equal(
    split?.chunks
      .map((chunk) => chunk[0]?.content ?? "")
      .join("\n"),
    "Bathroom every 2 hours\nSnack before school\nWater bottle in van"
  );
}

function testMedicationPortalDumpIsCompacted() {
  const normalized = __summaryGenerationTestUtils.normalizeSummarySourceText(`Medications

Current Medications
You can report new medications, request to remove medications from your list, and in certain cases request medication renewal here. How to request refills and renewals:
If you need a refill, contact the pharmacy as you may have an active prescription with refills available.
Click "Request renewal" if your prescription has no refills left or has expired.
Need to update your list of pharmacies? Go to Manage My Pharmacies.

clindamycin 1 % gel
Commonly known as: CLEOCIN T
Learn more
APPLY THIN LAYER TOPICALLY TO THE AFFECTED AREA TWICE DAILY AS NEEDED FOR REDNESS OR INFECTION
1 refill before March 27, 2027
Prescription Details
PrescribedMarch 27, 2026
Approved byJocelyn Ronda, MD
Quantity
60 g
Pharmacy Details
Walgreens Drugstore #17728 - EVERETT, MA - 405 BROADWAY AT NEC OF BROADWAY & 2ND ST
405 BROADWAY, EVERETT MA 02149-3435
617-387-0005
Map

melatonin 3 mg Tab
Learn more
Take 1 tablet (3 mg total) by mouth nightly at bedtime.
3 refills before March 17, 2027
Prescription Details
Day supply90
Pharmacy Details
Walgreens Drugstore #17728 - EVERETT, MA - 405 BROADWAY AT NEC OF BROADWAY & 2ND ST
Map`);

  assert.match(normalized, /clindamycin 1 % gel/i);
  assert.match(normalized, /melatonin 3 mg Tab/i);
  assert.match(normalized, /Take 1 tablet \(3 mg total\) by mouth nightly at bedtime\./i);
  assert.doesNotMatch(normalized, /Request renewal|Pharmacy Details|Walgreens Drugstore|Map/i);
  assert.ok(normalized.length < 260);
}

function testLongAnswerCompressionPreservesKeyFacts() {
  const raw = `Ashley responds best to enthusiasm and affirmation. ${
    "You know what I mean? ".repeat(80)
  }She has to have food in her stomach before morning medications. ${
    "That totally makes sense. ".repeat(30)
  }If she starts limping, get her leg up and check her ankle. Call Laurie any time at 617-555-1212. Weighted blanket or a snack may help when she starts to rage. ${
    "This part is repetitive and not useful. ".repeat(60)
  }`;

  const compressed = __summaryGenerationTestUtils.compressLongSummaryAnswer(raw);

  assert.ok(compressed.length < raw.length);
  assert.match(compressed, /food in her stomach before morning medications/i);
  assert.match(compressed, /limping, get her leg up and check her ankle/i);
  assert.match(compressed, /617-555-1212/);
  assert.match(compressed, /Weighted blanket or a snack may help/i);
  assert.doesNotMatch(compressed, /you know what i mean/i);
  assert.doesNotMatch(compressed, /that totally makes sense/i);
}

function testLongAnswerCompressionPrefersMoreSpecificOverlap() {
  const raw = `Call Laurie. Call Laurie at 617-555-1212. ${
    "You know what I mean? ".repeat(180)
  }`;

  const compressed = __summaryGenerationTestUtils.compressLongSummaryAnswer(raw);

  assert.match(compressed, /Call Laurie at 617-555-1212\./);
  assert.doesNotMatch(compressed, /^Call Laurie\.$/m);
}

function testCaptureBatchingGroupsSmallEntries() {
  const entries = Array.from({ length: 4 }, (_, index) =>
    __summaryGenerationTestUtils.createSummarySourceEntry(
      {
        sectionTitle: "Communication",
        stepId: "communication",
        stepTitle: "Communication",
        promptLabel: `Prompt ${index + 1}`
      },
      `Entry ${index + 1}`,
      `Signal ${index + 1}: ${"help ".repeat(45).trim()}`,
      {
        internalEntryId: `entry-${index + 1}`,
        splitDepth: 0,
        splitStrategy: "entry"
      }
    )
  );

  const batches = __summaryGenerationTestUtils.buildCaptureEntryBatches(entries);

  assert.ok(batches.length < entries.length);
  assert.equal(
    batches.flatMap((batch) => batch.map((entry) => entry.internalEntryId)).join(","),
    entries.map((entry) => entry.internalEntryId).join(",")
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
    diagnostics.some((line) => /strategy=(paragraph|line|sentence|chars)/.test(line)),
    diagnostics.join("\n")
  );
  assert.match(facts.map((fact) => fact.statement).join("\n"), /non-speaking/i);
  assert.match(facts.map((fact) => fact.statement).join("\n"), /presses help/i);
}

async function testMapWithConcurrencyPreservesOrder() {
  const results = await __summaryGenerationTestUtils.mapWithConcurrency(
    [0, 1, 2, 3],
    2,
    async (value: number) => {
      await new Promise((resolve) => setTimeout(resolve, (4 - value) * 5));
      return `item-${value}`;
    }
  );

  assert.deepEqual(results, ["item-0", "item-1", "item-2", "item-3"]);
}

async function testMapWithConcurrencyStopsQueueAfterFirstError() {
  const started: number[] = [];

  await assert.rejects(() =>
    __summaryGenerationTestUtils.mapWithConcurrency([0, 1, 2, 3], 2, async (value: number) => {
      started.push(value);

      if (value === 0) {
        throw new Error("boom");
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
      return value;
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.ok(started.includes(0));
  assert.ok(started.includes(1));
  assert.ok(!started.includes(2), `Unexpected work started after failure: ${started.join(",")}`);
  assert.ok(!started.includes(3), `Unexpected work started after failure: ${started.join(",")}`);
}

function testDedupeCaptureFactsReindexesDuplicateIds() {
  const facts = __summaryGenerationTestUtils.dedupeCaptureFacts([
    {
      factId: "entry-1-fact-1",
      entryId: "Entry 1",
      section: "Communication",
      factKind: "communication_method",
      statement: "Ashley uses spoken language.",
      safetyRelevant: false,
      conceptKeys: ["spoken language"],
      sourceEntryIds: ["Entry 1"]
    },
    {
      factId: "entry-1-fact-1",
      entryId: "Entry 1",
      section: "Communication",
      factKind: "communication_signal",
      statement: "When upset, she shouts and flares her arms.",
      safetyRelevant: false,
      conceptKeys: ["shouts", "flares arms"],
      sourceEntryIds: ["Entry 1"]
    },
    {
      factId: "entry-1-fact-2",
      entryId: "Entry 1",
      section: "Health & Safety",
      factKind: "medication",
      statement: "Melatonin is given at bedtime.",
      safetyRelevant: true,
      conceptKeys: ["melatonin", "bedtime"],
      sourceEntryIds: ["Entry 1"]
    }
  ]);

  assert.equal(facts.length, 3);
  assert.equal(new Set(facts.map((fact) => fact.factId)).size, 3);
  assert.deepEqual(facts.map((fact) => fact.factId), [
    "entry-1-fact-1",
    "entry-1-fact-2",
    "entry-1-fact-3"
  ]);
}

function testPersistedFactRoundTripKeepsRouting() {
  const inputFacts: StructuredSummaryFact[] = [
    {
      factId: "entry-1-fact-1",
      entryId: "Entry 1",
      sectionTitle: "Health & Safety",
      factKind: "medication",
      statement: "Melatonin is given at bedtime.",
      safetyRelevant: true,
      conceptKeys: ["melatonin", "bedtime"],
      sourceEntryIds: ["Entry 1"],
      sourceTurnsHash: "turn-hash"
    },
    {
      factId: "entry-2-fact-1",
      entryId: "Entry 2",
      sectionTitle: "Who to contact (and when)",
      factKind: "contact",
      statement: "Contact Laurie at (617) 555-1212.",
      safetyRelevant: true,
      conceptKeys: ["laurie", "6175551212"],
      sourceEntryIds: ["Entry 2"],
      sourceTurnsHash: "turn-hash"
    }
  ];

  const capture = __summaryGenerationTestUtils.captureFromPersistedFacts(inputFacts);
  const roundTrip = __summaryGenerationTestUtils.persistedFactsFromCapture(capture, "turn-hash");

  assert.deepEqual(
    roundTrip.map((fact) => ({
      factId: fact.factId,
      sectionTitle: fact.sectionTitle,
      factKind: fact.factKind,
      statement: fact.statement
    })),
    inputFacts.map((fact) => ({
      factId: fact.factId,
      sectionTitle: fact.sectionTitle,
      factKind: fact.factKind,
      statement: fact.statement
    }))
  );
}

function testSectionSummaryArtifactsMirrorFinalSummary() {
  const summary = emptySummary();
  summary.sections = summary.sections.map((section) =>
    section.title === "Health & Safety"
      ? {
          ...section,
          items: ["Melatonin is given at bedtime.", "Close overnight supervision is required."]
        }
      : section.title === "Who to contact (and when)"
        ? {
            ...section,
            items: ["Contact Laurie at (617) 555-1212."]
          }
        : section
  );

  const sectionSummaries = __summaryGenerationTestUtils.sectionSummariesFromSummary(
    summary,
    "turn-hash"
  );

  assert.equal(sectionSummaries.length, 8);
  assert.ok(sectionSummaries.every((section) => section.sourceTurnsHash === "turn-hash"));
  assert.deepEqual(
    sectionSummaries.find((section) => section.sectionTitle === "Health & Safety")?.items,
    ["Melatonin is given at bedtime.", "Close overnight supervision is required."]
  );
  assert.deepEqual(
    sectionSummaries.find((section) => section.sectionTitle === "Who to contact (and when)")?.items,
    ["Contact Laurie at (617) 555-1212."]
  );
}

function testRetryableRewriteErrors() {
  assert.equal(
    __summaryGenerationTestUtils.isRetryableRewriteError(
      new SummaryModelRequestError("temporary empty", { kind: "empty" })
    ),
    true
  );
  assert.equal(
    __summaryGenerationTestUtils.isRetryableRewriteError(
      new SummaryModelRequestError("temporary provider failure", {
        kind: "provider",
        status: 502
      })
    ),
    true
  );
  assert.equal(
    __summaryGenerationTestUtils.isRetryableRewriteError(
      new SummaryModelRequestError("rate limited", {
        kind: "provider",
        status: 429
      })
    ),
    true
  );
  assert.equal(
    __summaryGenerationTestUtils.isRetryableRewriteError(
      new SummaryModelRequestError("bad request", {
        kind: "provider",
        status: 400
      })
    ),
    false
  );
  assert.equal(
    __summaryGenerationTestUtils.isRetryableRewriteError(
      new SummaryModelRequestError("parse failure", { kind: "parse" })
    ),
    true
  );
}

function testAuthoritativeGeneratedItemsStayIntact() {
  const summary = emptySummary();
  summary.sections = summary.sections.map((section) =>
    section.title === "Communication"
      ? {
          ...section,
          items: ["She uses spoken language; ask her to slow down and speak louder."]
        }
      : section
  );

  const normalized = normalizeAuthoritativeStructuredSummary(summary, "Ashley");
  const items = sectionItems(normalized, "Communication");

  assert.ok(items.length <= 2);
  assert.match(items.join(" "), /spoken language/i);
  assert.match(items.join(" "), /slow down and speak louder/i);
}

function testOverviewPrefersRealRiskAndContactContent() {
  const summary = emptySummary();
  summary.sections = summary.sections.map((section) =>
    section.title === "Health & Safety"
      ? {
          ...section,
          items: [
            "Close overnight supervision is required because she may leave the house at night.",
            "Compression stockings are required on both legs."
          ]
        }
      : section.title === "Who to contact (and when)"
        ? {
            ...section,
            items: ["Contact Laurie at (617) 555-1212."]
          }
        : section.title === "Communication"
          ? {
              ...section,
              items: ["She uses spoken language, but others may need to ask her to repeat herself."]
            }
          : section
  );

  const normalized = normalizeAuthoritativeStructuredSummary(summary, "Ashley");
  const overviewLines = getOverviewLines(normalized.overview);

  assert.doesNotMatch(overviewLines[2] ?? "", /^Top Risks:\s+Not provided$/i);
  assert.match(overviewLines[2] ?? "", /overnight supervision|leave the house|compression stockings/i);
  assert.match(overviewLines[4] ?? "", /^Emergency Contact:\s+Laurie/i);
}

function testOverviewPrefersMajorHealthRiskOverMinorSign() {
  const summary = emptySummary();
  summary.sections = summary.sections.map((section) =>
    section.title === "Health & Safety"
      ? {
          ...section,
          items: [
            "She has a history of vein thrombosis and a double pulmonary embolism.",
            "Compression stockings are required on both legs."
          ]
        }
      : section.title === "Signs they need help"
        ? {
            ...section,
            items: ["Limping or low energy can signal that she does not feel well."]
          }
        : section
  );

  const normalized = normalizeAuthoritativeStructuredSummary(summary, "Ashley");
  const overviewLines = getOverviewLines(normalized.overview);

  assert.match(overviewLines[2] ?? "", /thrombosis|pulmonary embolism|compression stockings/i);
}

function testAuthoritativeRoutingKeepsHealthAndContactOutOfHardTime() {
  const summary = emptySummary();
  summary.sections = summary.sections.map((section) =>
    section.title === "Signs they need help"
      ? {
          ...section,
          items: ["Visual schedules are nice reinforcements."]
        }
      : section.title === "What helps when they are having a hard time"
        ? {
            ...section,
            items: [
              "Use transport tape instead of Band-Aids.",
              "Do not hesitate to call for help when needed.",
              "Offer only two choices when you want a meaningful answer.",
              "Use direct, concrete prompts such as asking whether she wants scrambled eggs or to listen to her music class song."
            ]
          }
        : section
  );

  const normalized = normalizeAuthoritativeStructuredSummary(summary, "Ashley");

  assert.doesNotMatch(sectionText(normalized, "Signs they need help"), /visual schedules?/i);
  assert.match(sectionText(normalized, "What helps the day go well"), /visual schedules?/i);
  assert.doesNotMatch(sectionText(normalized, "What helps when they are having a hard time"), /transport tape|Band-Aids?|call for help/i);
  assert.match(sectionText(normalized, "Health & Safety"), /transport tape|Band-Aids?/i);
  assert.match(sectionText(normalized, "Who to contact \(and when\)"), /call for help when needed/i);
  assert.match(sectionText(normalized, "Communication"), /two choices|scrambled eggs|music class song/i);
}

function testTieredCaptureAuditDoesNotForceTierThreeCoverage() {
  const capture = {
    facts: [
      {
        factId: "entry-1-fact-1",
        entryId: "Entry 1",
        section: "What helps the day go well",
        factKind: "preference",
        statement: "She enjoys spa days.",
        safetyRelevant: false,
        conceptKeys: ["spa days"],
        sourceEntryIds: ["Entry 1"]
      },
      {
        factId: "entry-2-fact-1",
        entryId: "Entry 2",
        section: "Health & Safety",
        factKind: "safety_risk",
        statement: "Close overnight supervision is required because she may leave the house at night.",
        safetyRelevant: true,
        conceptKeys: ["overnight supervision", "leave the house"],
        sourceEntryIds: ["Entry 2"]
      }
    ]
  } as any;

  const summary = emptySummary();
  const issues = __summaryGenerationTestUtils.auditSummaryAgainstCapture(summary, capture);

  assert.ok(
    issues.some(
      (issue) => issue.expectedSection === "Health & Safety" && issue.code === "missing_coverage"
    )
  );
  assert.ok(
    !issues.some(
      (issue) =>
        issue.expectedSection === "What helps the day go well" && issue.code === "missing_coverage"
    )
  );
}

function testRejectedBulletReasonsCatchNoisePatterns() {
  const capture = {
    facts: [
      {
        factId: "entry-1-fact-1",
        entryId: "Entry 1",
        section: "Communication",
        factKind: "communication_method",
        statement: "Ashley uses spoken language.",
        safetyRelevant: false,
        conceptKeys: ["spoken language"],
        sourceEntryIds: ["Entry 1"]
      },
      {
        factId: "entry-2-fact-1",
        entryId: "Entry 2",
        section: "Signs they need help",
        factKind: "help_sign",
        statement: "When upset, she yells and swears.",
        safetyRelevant: false,
        conceptKeys: ["yells", "swears"],
        sourceEntryIds: ["Entry 2"]
      }
    ]
  } as any;

  assert.equal(
    __summaryGenerationTestUtils.rejectedBulletReason(
      "Signs they need help",
      "Ask what happened and offer a drink.",
      capture,
      ["Ask what happened and offer a drink."]
    ),
    "signs_shape"
  );
  assert.equal(
    __summaryGenerationTestUtils.rejectedBulletReason(
      "Communication",
      'She almost always says "yeah.',
      capture,
      ['She almost always says "yeah.']
    ),
    "unmatched_quotes"
  );
  assert.equal(
    __summaryGenerationTestUtils.rejectedBulletReason(
      "What helps when they are having a hard time",
      "She is yelling and swearing.",
      capture,
      ["She is yelling and swearing."]
    ),
    "hard_time_shape"
  );
  assert.equal(
    __summaryGenerationTestUtils.rejectedBulletReason(
      "Communication",
      "Helping him find items on his iPad can prevent frustration.",
      capture,
      ["Helping him find items on his iPad can prevent frustration."]
    ),
    "pronoun_contamination"
  );
  assert.equal(
    __summaryGenerationTestUtils.rejectedBulletReason(
      "What helps when they are having a hard time",
      "Use transport tape instead of Band-Aids.",
      capture,
      ["Use transport tape instead of Band-Aids."]
    ),
    "hard_time_shape"
  );
  assert.equal(
    __summaryGenerationTestUtils.rejectedBulletReason(
      "What can upset or overwhelm them",
      "Her teeth are crowded and she is not a big flosser.",
      capture,
      ["Her teeth are crowded and she is not a big flosser."]
    ),
    "trigger_shape"
  );
  assert.equal(
    __summaryGenerationTestUtils.rejectedBulletReason(
      "Signs they need help",
      "Sometimes she can respond when dysregulated.",
      capture,
      ["Sometimes she can respond when dysregulated."]
    ),
    "signs_shape"
  );
  assert.equal(
    __summaryGenerationTestUtils.rejectedBulletReason(
      "What helps when they are having a hard time",
      "Do not hesitate to call.",
      capture,
      ["Do not hesitate to call."]
    ),
    "hard_time_shape"
  );
  assert.equal(
    __summaryGenerationTestUtils.rejectedBulletReason(
      "What helps the day go well",
      "On very hard angry or frustrated days, she may swear or hit herself in the head.",
      capture,
      ["On very hard angry or frustrated days, she may swear or hit herself in the head."]
    ),
    "day_shape"
  );
}

function testSectionFactAdmissibilityStripsShapeLeaks() {
  assert.equal(
    __summaryGenerationTestUtils.sectionFactIsAdmissible({
      factId: "entry-1-fact-1",
      entryId: "Entry 1",
      section: "Signs they need help",
      factKind: "help_sign",
      statement:
        "Her caretakers need to see if they can pick up any antecedents or cues from her environment when her behavior changes.",
      safetyRelevant: false,
      conceptKeys: ["antecedents", "cues"],
      sourceEntryIds: ["Entry 1"]
    } as any),
    false
  );
  assert.equal(
    __summaryGenerationTestUtils.sectionFactIsAdmissible({
      factId: "entry-2-fact-1",
      entryId: "Entry 2",
      section: "What helps when they are having a hard time",
      factKind: "caregiver_action",
      statement: "Use transport tape instead of Band-Aids.",
      safetyRelevant: false,
      conceptKeys: ["transport tape", "Band-Aids"],
      sourceEntryIds: ["Entry 2"]
    } as any),
    false
  );
  assert.equal(
    __summaryGenerationTestUtils.sectionFactIsAdmissible({
      factId: "entry-3-fact-1",
      entryId: "Entry 3",
      section: "What can upset or overwhelm them",
      factKind: "trigger",
      statement: "Her teeth are crowded and she is not a big flosser.",
      safetyRelevant: false,
      conceptKeys: ["teeth", "flosser"],
      sourceEntryIds: ["Entry 3"]
    } as any),
    false
  );
  assert.equal(
    __summaryGenerationTestUtils.sectionFactIsAdmissible({
      factId: "entry-4-fact-1",
      entryId: "Entry 4",
      section: "What can upset or overwhelm them",
      factKind: "trigger",
      statement:
        "When her self-directed plans get canceled because of weather or car problems, she can get very upset and tailspin.",
      safetyRelevant: false,
      conceptKeys: ["plans", "weather", "car problems", "tailspin"],
      sourceEntryIds: ["Entry 4"]
    } as any),
    true
  );
  assert.equal(
    __summaryGenerationTestUtils.sectionFactIsAdmissible({
      factId: "entry-5-fact-1",
      entryId: "Entry 5",
      section: "Signs they need help",
      factKind: "help_sign",
      statement: "Sometimes she can respond when dysregulated.",
      safetyRelevant: false,
      conceptKeys: ["respond"],
      sourceEntryIds: ["Entry 5"]
    } as any),
    false
  );
  assert.equal(
    __summaryGenerationTestUtils.sectionFactIsAdmissible({
      factId: "entry-6-fact-1",
      entryId: "Entry 6",
      section: "What helps when they are having a hard time",
      factKind: "caregiver_action",
      statement: "Do not hesitate to call.",
      safetyRelevant: false,
      conceptKeys: ["call"],
      sourceEntryIds: ["Entry 6"]
    } as any),
    false
  );
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
  testSavedSummaryQaAllowsConciseSupportAndTriggerBullets();
  testSavedSummaryQaStillWarnsOnLongPreferenceInventory();
  testAuditClassificationAndUserFiltering();
  testRepairHintSelectionSkipsSoftCoverageNoise();
  testIndexedRepairHintsRouteBySection();
  testSectionRepairHintsTargetOnlyImpactedSections();
  testStructuredJsonRecoveryUtilities();
  testCaptureRetryPrefersLineSplitForListStyleEntries();
  testMedicationPortalDumpIsCompacted();
  testLongAnswerCompressionPreservesKeyFacts();
  testLongAnswerCompressionPrefersMoreSpecificOverlap();
  testCaptureBatchingGroupsSmallEntries();
  testDedupeCaptureFactsReindexesDuplicateIds();
  testPersistedFactRoundTripKeepsRouting();
  testSectionSummaryArtifactsMirrorFinalSummary();
  testRetryableRewriteErrors();
  testAuthoritativeGeneratedItemsStayIntact();
  testOverviewPrefersRealRiskAndContactContent();
  testOverviewPrefersMajorHealthRiskOverMinorSign();
  testAuthoritativeRoutingKeepsHealthAndContactOutOfHardTime();
  testTieredCaptureAuditDoesNotForceTierThreeCoverage();
  testRejectedBulletReasonsCatchNoisePatterns();
  testSectionFactAdmissibilityStripsShapeLeaks();
  await testSingleEntryCaptureTruncationRetry();
  await testMapWithConcurrencyPreservesOrder();
  await testMapWithConcurrencyStopsQueueAfterFirstError();

  console.log("summary pipeline tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
