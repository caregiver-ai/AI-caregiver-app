import assert from "node:assert/strict";
import {
  QUESTIONNAIRE_VERSION,
  SECTION_INSTRUCTIONS,
  getQuestionnairePrompts,
} from "../lib/questionnaire";
import {
  QUESTIONNAIRE_PROMPT_MIGRATION_TARGETS,
  migrateSessionDraftQuestionnaire,
} from "../lib/questionnaire-migration";
import { processStoppedRecording } from "../lib/recording";
import {
  PREFERRED_SUMMARY_SECTION_ORDER,
  buildFallbackSummary,
  inferAuthoritativeSectionTitle,
  normalizeAuthoritativeStructuredSummary,
  summaryToPlainText,
} from "../lib/summary";
import { buildSummaryEmailHtml } from "../lib/summary-pdf";
import {
  expandTurnsForSummaryCapture,
  generateCaregiverSummaryWithQa,
  parseStructuredCompletionContent,
} from "../lib/summary-generation";
import {
  SUMMARY_LAYOUT_VERSION,
  SUMMARY_PIPELINE_VERSION,
  computeTurnsHash,
  getSummaryFreshness,
} from "../lib/summary-structured";
import {
  applyReviewedSummaryEdits,
  archiveDraftSummaries,
} from "../lib/summary-versioning";
import type {
  ConversationTurn,
  SessionDraft,
  StructuredSummary,
  UiLanguage,
} from "../lib/types";

const languages: UiLanguage[] = ["english", "spanish", "mandarin"];
const expectedSections = [...PREFERRED_SUMMARY_SECTION_ORDER] as const;
const expectedQuestionnaireSections = [
  "Communication",
  "Understanding and Learning",
  "Daily Schedule",
  "Activities & Preferences",
  "Signs They Are Having a Hard Time",
  "What helps when they are having a hard time",
  "Health & Safety",
] as const;

function responseTurns(
  promptId: string,
  prompt: string,
  content: string,
  createdAt: string,
  skipped = false,
): ConversationTurn[] {
  return [
    {
      id: promptId,
      role: "assistant",
      promptType: "section_prompt",
      content: prompt,
      promptLabel: prompt,
      createdAt,
    },
    {
      id: `${promptId}-response`,
      role: "user",
      promptType: "section_prompt",
      content,
      promptId,
      createdAt,
      skipped,
    },
  ];
}

function answerFor(draft: SessionDraft, promptId: string) {
  return draft.turns.find(
    (turn) => turn.role === "user" && turn.promptId === promptId,
  );
}

function makeDraft(turns: ConversationTurn[]): SessionDraft {
  return {
    sessionId: "migration-test",
    email: "caregiver@example.com",
    consented: true,
    intakeDetails: {
      caregiverFirstName: "Care",
      caregiverLastName: "Giver",
      caregiver55OrOlder: "yes",
      caregiverPhone: "",
      careRecipientFirstName: "Jamie",
      careRecipientLastName: "Example",
      careRecipientPreferredName: "Jay",
      careRecipientDateOfBirth: "",
      preferredLanguage: "english",
    },
    turns,
  };
}

function summaryWithVersions(
  turns: ConversationTurn[],
  overrides: Partial<StructuredSummary> = {},
): StructuredSummary {
  return {
    title: "Caring for Jay",
    overview: "Communication: Uses short phrases.",
    sections: expectedSections.map((title, index) => ({
      id: `section-${index + 1}`,
      title,
      items: ["No information provided yet."],
    })),
    generatedAt: "2026-06-01T12:05:00.000Z",
    sourceTurnsHash: computeTurnsHash(turns),
    pipelineVersion: SUMMARY_PIPELINE_VERSION,
    layoutVersion: SUMMARY_LAYOUT_VERSION,
    ...overrides,
  };
}

function testQuestionnaireContract() {
  const english = getQuestionnairePrompts("english");
  const expectedIds = english.map((prompt) => prompt.id);

  assert.equal(english.length, 25);
  assert.deepEqual(
    [...new Set(english.map((prompt) => prompt.sectionTitle))],
    expectedQuestionnaireSections,
  );
  assert.deepEqual(
    english.find(
      (prompt) => prompt.id === "communication-what-helps-you-communicate",
    )?.examples,
    [
      "giving limited choices",
      "keeping language simple",
      "waiting before repeating",
      "using pictures",
      "writing",
      "or demonstrations",
    ],
  );

  for (const language of languages) {
    const prompts = getQuestionnairePrompts(language);
    assert.equal(prompts.length, 25, `${language} prompt count`);
    assert.deepEqual(
      prompts.map((prompt) => prompt.id),
      expectedIds,
      `${language} prompt IDs and order`,
    );
    assert.equal(
      new Set(prompts.map((prompt) => prompt.stepId)).size,
      7,
      `${language} section count`,
    );
    assert.ok(
      prompts.every(
        (prompt) =>
          prompt.stepSubtitle === SECTION_INSTRUCTIONS[language] &&
          prompt.examples.length > 0 &&
          prompt.examples.every((example) => example.trim().length > 0),
      ),
      `${language} instructions and examples`,
    );
  }
}

function testStructuredCompletionParsing() {
  assert.deepEqual(parseStructuredCompletionContent('{"facts":[]}'), { facts: [] });
  assert.deepEqual(
    parseStructuredCompletionContent('```json\n{"facts":[]}\n```'),
    { facts: [] },
  );
  assert.throws(() => parseStructuredCompletionContent('{"facts":['), SyntaxError);
}

async function testSummaryCaptureBatchingWithMockedModel() {
  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  let captureCalls = 0;

  process.env.OPENAI_API_KEY = "test-summary-key";
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
      response_format?: { json_schema?: { name?: string } };
      messages?: Array<{ content?: string }>;
    };
    const schemaName = requestBody.response_format?.json_schema?.name;

    if (schemaName === "caregiver_handoff_structured_capture") {
      captureCalls += 1;
      const prompt = String(requestBody.messages?.at(-1)?.content ?? "");
      const entryIds = [...new Set([...prompt.matchAll(/\bEntry \d+\b/g)].map((match) => match[0]))];
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  facts: entryIds.map((entryId) => {
                    const communicationDetails = [
                      "uses short words to communicate",
                      "uses gestures to communicate",
                      "uses a communication device",
                      "points to choices",
                    ];
                    const entryNumber = Number(entryId.match(/\d+/)?.[0] ?? "1");

                    return {
                      entryId,
                      section: "Communication",
                      factKind: "communication_method",
                      subcategory: "General",
                      statement: `${entryId} ${communicationDetails[(entryNumber - 1) % communicationDetails.length]}.`,
                      safetyRelevant: false,
                    };
                  }),
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (schemaName === "caregiver_handoff_insights") {
      const prompt = String(requestBody.messages?.at(-1)?.content ?? "");
      const factIds = [
        ...new Set(
          [...prompt.matchAll(/\[([a-z0-9-]+-fact-\d+)\]/g)]
            .map((match) => match[1])
            .filter((factId): factId is string => Boolean(factId)),
        ),
      ];
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  insights:
                    factIds.length >= 2
                      ? [
                          {
                            insightId: "mock-communication-pattern",
                            section: "Communication",
                            statement: "Mock has a consistent communication support pattern.",
                            supportingFactIds: factIds.slice(0, 2),
                            themes: ["communication support"],
                          },
                        ]
                      : [],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    assert.equal(schemaName, "caregiver_handoff_summary");
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                title: "Caring for Mock",
                overview: "Mock communicates with support.",
                communication: ["Mock communicates with support."],
                understandingAndLearning: ["(No information provided)"],
                dailySchedule: ["(No information provided)"],
                activitiesAndPreferences: ["(No information provided)"],
                signsTheyAreHavingAHardTime: ["(No information provided)"],
                whatHelpsWhenTheyAreHavingAHardTime: ["(No information provided)"],
                healthAndSafety: ["(No information provided)"],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const longAnswer = "Uses short words, gestures, and a communication device. ".repeat(35);
    const turns = [
      ...responseTurns("mock-1", "How do they communicate?", longAnswer, "2026-06-01T12:00:00.000Z"),
      ...responseTurns("mock-2", "What helps?", longAnswer, "2026-06-01T12:01:00.000Z"),
      ...responseTurns("mock-3", "What do signs mean?", longAnswer, "2026-06-01T12:02:00.000Z"),
      ...responseTurns("mock-4", "What else?", longAnswer, "2026-06-01T12:03:00.000Z"),
    ];

    const result = await generateCaregiverSummaryWithQa(turns, "Mock", "two-step");
    assert.equal(result.summary.sections.length, PREFERRED_SUMMARY_SECTION_ORDER.length);
    assert.equal(result.summary.caregiverInsights?.length, 1);
    assert.equal(result.summary.caregiverInsights?.[0]?.supportingFactIds.length, 2);
    assert.ok(result.facts.length > 0);
    assert.equal(result.sectionSummaries.length, PREFERRED_SUMMARY_SECTION_ORDER.length);
    assert.ok(captureCalls > 1, "expected large capture input to be split across model calls");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousApiKey;
    }
  }
}

async function testGuideLayoutGroupingWithMockedFacts() {
  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;

  process.env.OPENAI_API_KEY = "test-summary-key";
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
      response_format?: { json_schema?: { name?: string } };
      messages?: Array<{ content?: string }>;
    };
    const schemaName = requestBody.response_format?.json_schema?.name;

    if (schemaName === "caregiver_handoff_structured_capture") {
      const facts = [
        ["Communication", "communication_method", "AAC", "Gavin is non-speaking."],
        ["Communication", "communication_method", "AAC", "Gavin communicates with sounds."],
        ["Communication", "communication_method", "AAC", "Gavin communicates with AAC."],
        ["Communication", "communication_method", "AAC", "Gavin's AAC system is TouchChat on an iPad."],
        ["Communication", "communication_method", "AAC", "Gavin uses TouchChat on an iPad to ask for help."],
        ["Communication", "communication_method", "AAC", "Gavin uses TouchChat on an iPad to label what he wants."],
        ["Communication", "communication_signal", "AAC", "If Gavin selects “I want iPad,” it may mean the internet is down."],
        ["Communication", "communication_signal", "AAC", "If Gavin selects “I want iPad,” it may mean his iPad is not working."],
        ["Communication", "communication_signal", "AAC", "If Gavin selects “I want iPad,” it may mean he cannot find the video he wants."],
        ["Communication", "communication_signal", "Places", "Usually places Gavin likes to go are IKEA or Bass Pro Shops in Foxborough."],
        ["Daily Schedule", "routine", "Hygiene", "He is assisted with deodorant."],
        ["Daily Schedule", "routine", "Hygiene", "He is assisted with dressing."],
        ["Daily Schedule", "routine", "Hygiene", "He is assisted with hair care."],
        ["Daily Schedule", "routine", "Hygiene", "He is assisted with socks."],
        ["Daily Schedule", "routine", "Hygiene", "He is assisted with teeth brushing."],
        ["Daily Schedule", "routine", "Hygiene", "Deodorant is put on Gavin before he gets dressed in the morning."],
        ["Daily Schedule", "routine", "Hygiene", "Gavin gets dressed after deodorant is put on in the morning."],
        ["Daily Schedule", "routine", "Hygiene", "Gavin will lift his arms when deodorant is being put on."],
        ["Daily Schedule", "routine", "Toileting", "If Gavin does not void, turning on the showerhead can help."],
        ["Daily Schedule", "routine", "Food", "He eats cheddar cheese."],
        ["Daily Schedule", "routine", "Food", "He eats green beans."],
        ["Daily Schedule", "routine", "Food", "He eats lettuce."],
        ["Daily Schedule", "routine", "Food", "He eats pasta with olive oil and parmesan."],
        ["Daily Schedule", "routine", "Food", "He eats pita with labneh and zaatar."],
        ["Daily Schedule", "routine", "Food", "He eats raw cauliflower."],
        ["Daily Schedule", "routine", "Food", "He eats ice cream, and he loves sprinkles."],
        ["Activities & Preferences", "preference", "Activities", "Preferred activities include YouTube, music, guitar, drums, car rides, car rides, exploring, malls, cupcakes, and chase."],
        ["Activities & Preferences", "preference", "Activities", "Mom is his favorite person."],
        ["Activities & Preferences", "preference", "Activities", "Downtime usually means being left alone to do his own thing."],
        ["Activities & Preferences", "preference", "Learning", "It helps Gavin if you show him things to pick from."],
        ["Activities & Preferences", "preference", "Learning", "Using a first-this-then-that format helps Gavin."],
        ["Activities & Preferences", "preference", "Learning", "It helps Gavin when choices are shown visually."],
        ["Activities & Preferences", "preference", "Communication", "Communicating non-verbally works for Gavin."],
        ["Understanding and Learning", "learning", "Expression", "Gavin understands more than he can express."],
        ["Signs They Are Having a Hard Time", "trigger", "Rigidity", "Gavin gets upset when things are moved."],
        ["Signs They Are Having a Hard Time", "trigger", "Rigidity", "Gavin gets upset when things are out of place."],
        ["Signs They Are Having a Hard Time", "trigger", "Rigidity", "Gavin is very rigid about lights being in the expected position."],
        ["Signs They Are Having a Hard Time", "trigger", "Rigidity", "Gavin is very rigid about shades being in the expected position."],
        ["Signs They Are Having a Hard Time", "trigger", "Lighting", "The home uses soft indirect lighting because overhead lighting is upsetting."],
        ["Signs They Are Having a Hard Time", "help_sign", "Illness", "If he is not drinking, check for illness or pain."],
        ["Signs They Are Having a Hard Time", "help_sign", "Illness", "If he is not eating, check for illness or pain."],
        ["Understanding and Learning", "learning", "Visual", "Gavin is very visual."],
        ["Understanding and Learning", "learning", "Visual", "Gavin learns best through videos."],
        ["Understanding and Learning", "learning", "Visual", "First-Then language helps Gavin."],
        ["What helps when they are having a hard time", "caregiver_action", "Calming", "Give him space when he is having a hard time."],
        ["What helps when they are having a hard time", "caregiver_action", "Calming", "Keep the environment quiet when he is having a hard time."],
        ["Health & Safety", "condition", "Diagnoses", "Gavin has Sensory Processing Difficulty."],
        ["Health & Safety", "equipment", "Equipment", "He uses noise-canceling headphones."],
        ["Health & Safety", "medication", "Medication", "Gavin takes Abilify (Aripiprazole) 15 mg once daily at 3pm."],
        ["Health & Safety", "medication", "Medication", "Gavin takes Abilify (Aripiprazole) for irritability, aggression, repetitive behaviors, and self-injury."],
        ["Health & Safety", "medication", "Medication", "Gavin takes Polyethylene glycol 3350 / MiraLax daily in water."],
        ["Health & Safety", "medication", "Medication", "Gavin takes Polyethylene glycol 3350 / MiraLax to keep stool regular."],
      ].map(([section, factKind, subcategory, statement], index) => ({
        entryId: `Entry ${index + 1}`,
        section,
        factKind,
        subcategory,
        statement,
        safetyRelevant: /illness|pain|safety|condition/i.test(statement),
      }));

      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify({ facts }) },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (schemaName === "caregiver_handoff_insights") {
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  insights: [
                    {
                      insightId: "visual-learning-pattern",
                      section: "Understanding and Learning",
                      statement:
                        "Gavin is a highly visual learner who benefits from videos and First-Then language.",
                      supportingFactIds: ["entry-14-fact-1", "entry-15-fact-1"],
                      themes: ["visual learning"],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    assert.equal(schemaName, "caregiver_handoff_summary");
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                title: "Caring for Gavin",
                overview: "Gavin benefits from visual support and calm environments.",
                communication: ["Gavin uses non-speaking communication."],
                understandingAndLearning: ["Gavin is very visual."],
                dailySchedule: ["He is assisted with deodorant."],
                activitiesAndPreferences: ["(No information provided)"],
                signsTheyAreHavingAHardTime: ["If he is not eating, check for illness or pain."],
                whatHelpsWhenTheyAreHavingAHardTime: ["Give him space."],
                healthAndSafety: ["Gavin has Sensory Processing Difficulty."],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const result = await generateCaregiverSummaryWithQa(
      responseTurns(
        "guide-1",
        "Gavin details",
        "Gavin has daily care, food, learning, support, and health details.",
        "2026-06-01T12:00:00.000Z",
      ),
      "Gavin",
      "two-step",
    );

    const plainText = summaryToPlainText(result.summary);

    assert.ok(result.facts.length >= 20);
    assert.equal(result.sectionSummaries.length, PREFERRED_SUMMARY_SECTION_ORDER.length);
    assert.ok(
      result.summary.sections.some(
        (section) => section.title === "Daily Routine" && (section.blocks?.length ?? 0) > 0,
      ),
      "expected guide sections to preserve grouped display blocks",
    );
    assert.ok(
      result.sectionSummaries.some(
        (section) => section.sectionTitle === "Daily Routine" && (section.itemsJson.blocks?.length ?? 0) > 0,
      ),
      "expected persisted section artifacts to include grouped blocks",
    );
    assert.match(sectionText(result.summary, "About"), /exploration|new experiences|exploring/i);
    assert.match(sectionText(result.summary, "About"), /understand.*speech|speech.*show/i);
    assert.match(plainText, /About Gavin[\s\S]*Overview|About Gavin[\s\S]*Communication:/i);
    assert.doesNotMatch(sectionText(result.summary, "About"), /Abilify|MiraLax|Diagnoses and conditions/i);
    assert.doesNotMatch(result.summary.overview, /How they communicate|Food and drink notes|Medications and allergies/i);
    assert.doesNotMatch(plainText, /include include|car rides,\s*car rides/i);
    assert.match(sectionText(result.summary, "Daily Routine"), /hygiene and dressing.*deodorant.*dressing.*hair care.*socks.*teeth brushing/i);
    assert.doesNotMatch(sectionText(result.summary, "Daily Routine"), /He is assisted with deodorant/i);
    assert.doesNotMatch(sectionText(result.summary, "Daily Routine"), /He is assisted with dressing/i);
    assert.equal(countSectionMatches(result.summary, "Daily Routine", /deodorant.*dressed|dressed.*deodorant/i), 1);
    assert.ok(countSectionMatches(result.summary, "Daily Routine", /showerhead/i) <= 1);
    assert.match(sectionText(result.summary, "Food and Meals"), /Foods include.*cheddar cheese.*green beans.*lettuce.*pasta.*pita.*raw cauliflower/i);
    assert.doesNotMatch(sectionText(result.summary, "Food and Meals"), /^Food and drink notes: He eats/im);
    assert.doesNotMatch(sectionText(result.summary, "Activities and Interests"), /\bcupcakes?\b/i);
    assert.doesNotMatch(sectionText(result.summary, "Activities and Interests"), /\bperson\b\./i);
    assert.doesNotMatch(sectionText(result.summary, "Activities and Interests"), /things to pick|first-this-then|choices are shown|communicating non-verbally/i);
    assert.doesNotMatch(sectionText(result.summary, "Communication"), /IKEA|Bass Pro/i);
    assert.match(sectionText(result.summary, "Activities and Interests"), /IKEA|Bass Pro/i);
    assert.match(sectionText(result.summary, "Communication"), /nonverbal|non-verbal|non-verbally/i);
    assert.match(sectionText(result.summary, "What Can Upset or Overwhelm"), /things are moved.*things are out of place|things are out of place.*things are moved/i);
    assert.equal(countSectionMatches(result.summary, "What Can Upset or Overwhelm", /things are (?:moved|out of place)/i), 1);
    assert.equal(countSectionMatches(result.summary, "What Can Upset or Overwhelm", /expected position/i), 1);
    assert.match(sectionText(result.summary, "What Can Upset or Overwhelm"), /Soft or indirect lighting/i);
    assert.match(sectionText(result.summary, "Signs They Need Help"), /not eating.*not drinking|not drinking.*not eating/i);
    assert.equal(countSectionMatches(result.summary, "Signs They Need Help", /If he is not (?:eating|drinking)/i), 0);
    assert.ok(countSectionMatches(result.summary, "Communication", /TouchChat on an iPad/i) <= 2);
    assert.match(sectionText(result.summary, "Communication"), /I want iPad.*internet.*not working.*video|I want iPad.*internet.*video.*not working|I want iPad.*not working.*internet.*video/i);
    assert.equal(countSectionMatches(result.summary, "Communication", /I want iPad/i), 1);
    assert.match(sectionText(result.summary, "Understanding and Learning"), /visual/i);
    assert.match(sectionText(result.summary, "Understanding and Learning"), /videos/i);
    assert.match(sectionText(result.summary, "Understanding and Learning"), /First-Then/i);
    assert.match(sectionText(result.summary, "Understanding and Learning"), /things to pick/i);
    assert.match(sectionText(result.summary, "Understanding and Learning"), /choices.*shown|shown.*choices|visual/i);
    assert.match(sectionText(result.summary, "What Helps When They Are Having a Hard Time"), /space|quiet/i);
    assert.match(sectionText(result.summary, "What Helps When They Are Having a Hard Time"), /Environmental supports include/i);
    assert.match(sectionText(result.summary, "Health & Safety"), /Sensory Processing Difficulty|noise-canceling headphones/i);
    assert.match(sectionText(result.summary, "Health & Safety"), /Abilify\/aripiprazole.*15 mg.*once daily.*3pm.*irritability.*aggression.*repetitive behaviors.*self-injury/i);
    assert.match(sectionText(result.summary, "Health & Safety"), /polyethylene glycol\/MiraLax.*daily.*water.*stool regular/i);
    assert.equal(countSectionMatches(result.summary, "Health & Safety", /Abilify|ARIPiprazole|aripiprazole/i), 1);
    assert.equal(countSectionMatches(result.summary, "Health & Safety", /MiraLax|Polyethylene glycol|polyethylene glycol/i), 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousApiKey;
    }
  }
}

function testEveryLegacyPromptMapping() {
  const expectedLegacyMappings = {
    "communication-how-do-they-communicate":
      "communication-how-do-they-communicate",
    "communication-what-helps-you-communicate":
      "communication-what-helps-you-communicate",
    "communication-what-do-specific-things-mean":
      "communication-what-do-specific-things-mean",
    "communication-how-can-you-tell-they-need-help":
      "hard-time-signs-behavior-communication",
    "daily-schedule-mornings": "daily-schedule-mornings",
    "daily-schedule-meals-snacks": "daily-schedule-meals-snacks",
    "daily-schedule-bedtime": "daily-schedule-bedtime",
    "daily-schedule-transitions": "hard-time-support-transitions",
    "daily-schedule-daytime-activities":
      "activities-preferences-favorite-activities",
    "activities-preferences-during-the-day":
      "activities-preferences-favorite-activities",
    "activities-preferences-favorite-activities":
      "activities-preferences-favorite-activities",
    "activities-preferences-outings": "activities-preferences-outings",
    "activities-preferences-trusted-people":
      "activities-preferences-trusted-people",
    "activities-preferences-quiet-time":
      "activities-preferences-favorite-activities",
    "upset-overwhelm-plan-changes": "hard-time-signs-situations-changes",
    "upset-overwhelm-environment": "hard-time-signs-situations-changes",
    "upset-overwhelm-physical-state": "hard-time-signs-situations-changes",
    "signs-need-help-body-signs": "signs-need-help-body-signs",
    "signs-need-help-behavior-changes":
      "hard-time-signs-behavior-communication",
    "signs-need-help-communication-changes":
      "hard-time-signs-behavior-communication",
    "hard-time-support-environment": "hard-time-support-environment",
    "hard-time-support-calming-items": "hard-time-support-calming-items",
    "hard-time-support-in-the-moment": "hard-time-support-environment",
    "health-safety-medical-info": "health-safety-allergies",
    "health-safety-medications-routines": "health-safety-diagnoses",
    "health-safety-equipment-supports": "health-safety-medications",
    "health-safety-safety-concerns": "health-safety-equipment-supports",
    "who-to-contact-emergency": "health-safety-contact-guidance",
    "who-to-contact-non-emergency": "health-safety-contact-guidance",
    "who-to-contact-call-guidance": "health-safety-contact-guidance",
  };

  for (const [legacyPromptId, targetPromptId] of Object.entries(
    expectedLegacyMappings,
  )) {
    assert.equal(
      QUESTIONNAIRE_PROMPT_MIGRATION_TARGETS[legacyPromptId],
      targetPromptId,
      legacyPromptId,
    );
  }
  assert.equal(Object.keys(expectedLegacyMappings).length, 30);
}

function testLegacyDraftMigration() {
  const turns = [
    ...responseTurns(
      "daily-schedule-daytime-activities",
      "What are their daytime activities?",
      "Music and drawing",
      "2026-06-01T12:01:00.000Z",
    ),
    ...responseTurns(
      "activities-preferences-favorite-activities",
      "What activities do they enjoy?",
      "Music and drawing",
      "2026-06-01T12:02:00.000Z",
    ),
    ...responseTurns(
      "activities-preferences-quiet-time",
      "What do they enjoy during quiet time?",
      "Tablet time",
      "2026-06-01T12:03:00.000Z",
    ),
    ...responseTurns(
      "upset-overwhelm-plan-changes",
      "What changes in plans are hard?",
      "Unexpected schedule changes",
      "2026-06-01T12:04:00.000Z",
    ),
    ...responseTurns(
      "upset-overwhelm-environment",
      "What environmental factors are hard?",
      "Crowded rooms",
      "2026-06-01T12:05:00.000Z",
    ),
    ...responseTurns(
      "upset-overwhelm-physical-state",
      "What physical factors are hard?",
      "Hunger",
      "2026-06-01T12:06:00.000Z",
    ),
    ...responseTurns(
      "signs-need-help-behavior-changes",
      "What behavior changes show distress?",
      "Pacing",
      "2026-06-01T12:07:00.000Z",
    ),
    ...responseTurns(
      "signs-need-help-communication-changes",
      "What communication changes show distress?",
      "Becomes quiet",
      "2026-06-01T12:08:00.000Z",
    ),
    ...responseTurns(
      "communication-how-can-you-tell-they-need-help",
      "How can you tell they need help?",
      "Repeats the same question",
      "2026-06-01T12:09:00.000Z",
    ),
    ...responseTurns(
      "daily-schedule-transitions",
      "What helps with transitions?",
      "A five-minute countdown",
      "2026-06-01T12:10:00.000Z",
    ),
    ...responseTurns(
      "hard-time-support-in-the-moment",
      "What helps in the moment?",
      "Move to a quiet room",
      "2026-06-01T12:11:00.000Z",
    ),
    ...responseTurns(
      "who-to-contact-emergency",
      "Who should be contacted in an emergency?",
      "Call Maya first",
      "2026-06-01T12:12:00.000Z",
    ),
    ...responseTurns(
      "who-to-contact-non-emergency",
      "Who should be contacted in non-emergencies?",
      "Then call Luis",
      "2026-06-01T12:13:00.000Z",
    ),
    ...responseTurns(
      "who-to-contact-call-guidance",
      "What should others know about when to call?",
      "Call 911 for breathing trouble",
      "2026-06-01T12:14:00.000Z",
    ),
  ];

  const migrated = migrateSessionDraftQuestionnaire(makeDraft(turns));
  assert.equal(migrated.questionnaireVersion, QUESTIONNAIRE_VERSION);
  assert.equal(
    migrated.turns.filter((turn) => turn.role === "assistant").length,
    6,
  );

  const activities = answerFor(
    migrated,
    "activities-preferences-favorite-activities",
  );
  assert.equal(activities?.content, "Music and drawing\n\nTablet time");
  assert.equal(activities?.createdAt, "2026-06-01T12:01:00.000Z");
  assert.equal(
    answerFor(migrated, "hard-time-signs-situations-changes")?.content,
    "Unexpected schedule changes\n\nCrowded rooms\n\nHunger",
  );
  assert.equal(
    answerFor(migrated, "hard-time-signs-behavior-communication")?.content,
    "Pacing\n\nBecomes quiet\n\nRepeats the same question",
  );
  assert.equal(
    answerFor(migrated, "hard-time-support-transitions")?.content,
    "A five-minute countdown",
  );
  assert.equal(
    answerFor(migrated, "hard-time-support-environment")?.content,
    "Move to a quiet room",
  );
  assert.equal(
    answerFor(migrated, "health-safety-contact-guidance")?.content,
    "Emergency contact: Call Maya first\n\n" +
      "Non-emergency contact: Then call Luis\n\n" +
      "When to call: Call 911 for breathing trouble",
  );
  assert.deepEqual(migrateSessionDraftQuestionnaire(migrated), migrated);
}

function testHealthMappingAndSkippedMigration() {
  const draft = makeDraft([
    ...responseTurns(
      "health-safety-medical-info",
      "Are there any allergies?",
      "Latex",
      "2026-06-01T12:00:00.000Z",
    ),
    ...responseTurns(
      "health-safety-medications-routines",
      "Do they have any health conditions?",
      "Epilepsy",
      "2026-06-01T12:01:00.000Z",
    ),
    ...responseTurns(
      "health-safety-equipment-supports",
      "Do they take any medication?",
      "Morning medication with food",
      "2026-06-01T12:02:00.000Z",
    ),
    ...responseTurns(
      "health-safety-safety-concerns",
      "Do they use any equipment or supports?",
      "Hearing aids",
      "2026-06-01T12:03:00.000Z",
    ),
    ...responseTurns(
      "who-to-contact-emergency",
      "Who should be contacted in an emergency?",
      "",
      "2026-06-01T12:04:00.000Z",
      true,
    ),
    ...responseTurns(
      "who-to-contact-non-emergency",
      "Who should be contacted in non-emergencies?",
      "",
      "2026-06-01T12:05:00.000Z",
      true,
    ),
  ]);
  const migrated = migrateSessionDraftQuestionnaire(draft);

  assert.equal(answerFor(migrated, "health-safety-allergies")?.content, "Latex");
  assert.equal(
    answerFor(migrated, "health-safety-diagnoses")?.content,
    "Epilepsy",
  );
  assert.equal(
    answerFor(migrated, "health-safety-medications")?.content,
    "Morning medication with food",
  );
  assert.equal(
    answerFor(migrated, "health-safety-equipment-supports")?.content,
    "Hearing aids",
  );

  const contact = answerFor(migrated, "health-safety-contact-guidance");
  assert.equal(contact?.skipped, true);
  assert.equal(contact?.createdAt, "2026-06-01T12:04:00.000Z");
}

function testSevenSectionSummaryNormalization() {
  const normalized = normalizeAuthoritativeStructuredSummary({
    title: "Caring for Jay",
    overview: "",
    generatedAt: "",
    pipelineVersion: "",
    layoutVersion: "",
    sourceTurnsHash: "",
    sections: [
      {
        id: "communication",
        title: "Communication",
        items: ["Uses short spoken phrases."],
      },
      {
        id: "daily",
        title: "Daily Needs & Routines",
        items: ["Wakes at 7 a.m."],
      },
      {
        id: "triggers",
        title: "What Can Upset Them",
        items: ["Crowded spaces are hard."],
      },
      {
        id: "signs",
        title: "Signs They May Need Help",
        items: ["They begin pacing."],
      },
      {
        id: "contacts",
        title: "Who to Contact",
        items: ["Call Maya first."],
      },
      {
        id: "learning",
        title: "Understanding and Learning",
        items: ["Learns best by watching a demonstration."],
      },
    ],
  });

  assert.deepEqual(
    normalized.sections.map((section) => section.title),
    PREFERRED_SUMMARY_SECTION_ORDER,
  );
  assert.ok(
    normalized.sections
      .find(
        (section) =>
          section.title === "What Can Upset or Overwhelm",
      )
      ?.items.some((item) => item.includes("Crowded spaces")),
  );
  assert.ok(
    normalized.sections
      .find((section) => section.title === "Health & Safety")
      ?.items.some((item) => item.includes("Call Maya")),
  );
}

function sectionItems(summary: StructuredSummary, title: string) {
  return (
    summary.sections.find((section) => section.title === title)?.items ?? []
  );
}

function sectionText(summary: StructuredSummary, title: string) {
  return sectionItems(summary, title).join("\n");
}

function countSectionMatches(summary: StructuredSummary, title: string, pattern: RegExp) {
  return sectionItems(summary, title).filter((item) => pattern.test(item)).length;
}

function testSummaryRoutingAndCleanup() {
  const normalized = normalizeAuthoritativeStructuredSummary({
    title: "Caring for Jay",
    overview: "",
    sections: [
      {
        id: "communication",
        title: "Communication",
        items: [
          "Behavior changes include pacing and becoming quiet",
          "She recognizes pictures and learns best by watching",
          "He presses help on his AAC device when he needs help",
          "He uses Touchchat on an Ipad to ask for help",
          "He uses an AAC device on an iPad with TouchChat",
          "He uses his AAC device to request car rides",
          "He uses his AAC device to tell caregivers when he wants his iPad",
          "He may lead a caregiver to what he needs",
          "Visual choices help him communicate",
          "Bowel movements happen in his pull-up",
          "Elopement is a sign that he needs help",
          "Hiding and grunting may mean he is having a bowel movement",
          "He requires constant supervision because of elopement risk",
          "Unsafe walking is a top safety risk",
          "On school days, he wakes around 7:20 a.",
        ],
      },
      {
        id: "support",
        title: "What helps when they are having a hard time",
        items: [
          "Give him space immediately",
          "Reduce stimulation and keep things quiet",
          "Give him space, reduce stimulation, and keep the environment quiet while redirecting",
          "Do not physically stop him from biting his hand because he may bite you",
          "Do not block hand biting because he may bite you",
          "Music helps him calm",
          "Car rides work best as resets",
          "Quiet environments work best as resets",
        ],
      },
      {
        id: "activities",
        title: "Activities & Preferences",
        items: [
          "He likes farms",
          "He likes animals",
          "He likes dinosaurs",
          "He likes cars",
          "He likes trucks",
          "He likes books",
          "He likes planets",
        ],
      },
    ],
  });

  assert.match(
    sectionText(normalized, "Understanding and Learning"),
    /recognizes pictures.*watching/i,
  );
  assert.match(
    sectionText(normalized, "Signs They Need Help"),
    /pacing.*quiet|presses help|Elopement is a sign|Hiding and grunting/i,
  );
  assert.doesNotMatch(
    sectionText(normalized, "Health & Safety"),
    /Elopement is a sign/i,
  );
  assert.match(
    sectionText(normalized, "Health & Safety"),
    /constant supervision.*elopement risk/i,
  );
  assert.match(
    sectionText(normalized, "Daily Routine"),
    /pull-up|7:20 a\.m\./i,
  );
  assert.match(
    sectionText(normalized, "Communication"),
    /AAC device.*iPad.*TouchChat.*ask for help.*request car rides.*wants his iPad/i,
  );
  assert.match(normalized.overview, /AAC device.*TouchChat/i);
  assert.match(
    normalized.overview,
    /Key safety risks include elopement, hand biting, and unsafe walking/i,
  );

  const supportItems = sectionItems(
    normalized,
    "What Helps When They Are Having a Hard Time",
  );
  assert.equal(
    supportItems.filter((item) => /space|stimulation/i.test(item)).length,
    1,
  );
  assert.equal(
    supportItems.filter((item) => /hand biting|biting his hand/i.test(item))
      .length,
    1,
  );
  assert.equal(
    sectionItems(normalized, "Signs They Need Help").filter(
      (item) => /hiding|grunting/i.test(item),
    ).length,
    1,
  );
  assert.match(supportItems.join("\n"), /Music helps him calm/i);
  assert.match(
    supportItems.join("\n"),
    /Helpful resets include car rides and quiet or low-light environments/i,
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "Limping is a sign they need help.",
      "What Helps When They Are Having a Hard Time",
    ),
    "Signs They Need Help",
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "Eloping is a sign they need help.",
      "What Helps When They Are Having a Hard Time",
    ),
    "Signs They Need Help",
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "They are not eating or drinking.",
      "What Helps When They Are Having a Hard Time",
    ),
    "Signs They Need Help",
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "Behavior or communication signs include hand biting, angry vocalizations, and pressing Help.",
      "Communication",
    ),
    "Signs They Need Help",
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "Do not block hand biting because they may bite the caregiver.",
      "Signs They Need Help",
    ),
    "What Helps When They Are Having a Hard Time",
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "If Gavin is really upset, giving him space is helpful.",
      "Signs They Need Help",
    ),
    "What Helps When They Are Having a Hard Time",
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "You can ask Gavin to count to 10, tell him to take a deep breath, or tell him to squeeze and release his hands, but these strategies help only if he is still somewhat calm.",
      "Signs They Need Help",
    ),
    "What Helps When They Are Having a Hard Time",
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "The most important thing when Gavin is very upset is to make sure he is safe and cannot hurt himself.",
      "Signs They Need Help",
    ),
    "What Helps When They Are Having a Hard Time",
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "Gavin takes ARIPiprazole 15 mg (Abilify) once a day at 3 pm to help manage irritability, aggression, repetitive behaviors, and self-injury.",
      "Signs They Need Help",
    ),
    "Health & Safety",
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "Gavin takes L'il Critters Gummy Vites Daily Multivitamin for Kids, 2 gummies per day.",
      "What Helps When They Are Having a Hard Time",
    ),
    "Health & Safety",
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "Gavin needs more than one person with him for car rides.",
      "Communication",
    ),
    "Health & Safety",
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "A structured routine helps Gavin's day go well.",
      "What Helps When They Are Having a Hard Time",
    ),
    "Daily Routine",
  );

  const dedupedSafetySummary = normalizeAuthoritativeStructuredSummary(
    summaryWithVersions([], {
      sections: expectedSections.map((title, index) => ({
        id: `dedupe-${index + 1}`,
        title,
        items:
          title === "Signs They Need Help"
            ? [
                "When Gavin is upset, he may elope.",
                "Gavin may elope when he is really upset.",
              ]
            : title === "Health & Safety"
              ? [
                  "Gavin needs more than one person with him for car rides.",
                  "Gavin needs more than one person with him for walks.",
                ]
              : ["(No information provided)"],
      })),
    }),
    "Gavin",
  );
  assert.equal(
    sectionItems(dedupedSafetySummary, "Signs They Need Help")
      .filter((item) => /elop/i.test(item)).length,
    1,
  );
  assert.match(
    sectionText(dedupedSafetySummary, "Health & Safety"),
    /car rides and walks/i,
  );

  const activities = sectionItems(normalized, "Activities and Interests");
  assert.equal(activities.length, 1);
  assert.match(activities[0] ?? "", /^Preferred activities include/i);
  for (const preference of [
    "farms",
    "animals",
    "dinosaurs",
    "cars",
    "trucks",
    "books",
    "planets",
  ]) {
    assert.match(activities[0] ?? "", new RegExp(`\\b${preference}\\b`, "i"));
  }
}

function testPastedGavinSummaryCleanup() {
  const normalized = normalizeAuthoritativeStructuredSummary(
    summaryWithVersions([], {
      title: "Caring for Gavin",
      overview: [
        "Communication: Gavin uses an AAC device on an iPad with TouchChat to ask for help. Gavin is non-speaking.",
        "Key Needs: Gavin has Sensory Processing Difficulty.",
        "Top Risks: Key safety risks include elopement and hand biting.",
        "Best Supports: Preferred activities include walks, scooter riding, swimming, swinging, jumping, crashing, obstacle courses, chase, bowling, basketball, and horseback riding, car rides, exploring, hikes, malls, museums, stores, and walking around new places, animals, farms, dinosaurs, cars, trucks, books, and planets, spending time with family, and cupcakes, cake, frosting, sprinkles, and candy.",
        "Emergency Contact: Labebe Awde, grandmother, 617-930-7229.",
      ].join("\n"),
      caregiverInsights: [
        {
          insightId: "visual-learning-pattern",
          section: "Understanding and Learning",
          statement:
            "Gavin is a highly visual learner who learns best through videos, visual schedules, and First-Then language.",
          supportingFactIds: ["entry-1-fact-1", "entry-2-fact-1"],
          themes: ["visual learning"],
        },
      ],
      sections: [
        {
          id: "communication",
          title: "Communication",
          items: [
            "Body language and other nonverbal communication help Gavin communicate.",
            "Gavin uses an AAC device on an iPad with TouchChat to ask for help.",
            "Gavin communicates with body language.",
            "Gavin communicates with sounds.",
            "Gavin is non-speaking.",
            "He may get physically close or sit very close to a caregiver when he wants attention.",
            "He may lead a caregiver to show what he needs.",
            "If he is too dysregulated, he may not be able to ask for help; look for physical and behavioral signs instead.",
            "Gavin may make happy sounds.",
            "Gavin may make singing-like sounds.",
            "Gavin does best with 2-step directions.",
            "Gavin does best with directions given as 'first this, then that.'",
            "Gavin is very visual.",
            "Gavin responds to gentle physical cues.",
            "It helps to show Gavin pictures to communicate choices.",
            "It helps to show Gavin the actual items to communicate choices.",
            "Tapping Gavin's foot can prompt him to lift it.",
            "Downtime usually means being left alone to do his own thing.",
          ],
        },
        {
          id: "understanding",
          title: "Understanding and Learning",
          items: ["Gavin has Sensory Processing Difficulty."],
        },
        {
          id: "daily",
          title: "Daily Schedule",
          items: [
            "Gavin does not tell caregivers when he needs the bathroom.",
            "He has a limited diet and grazes throughout the day rather than sitting for meals.",
            "He uses the bathroom with support and reminders.",
            "His bowel movements happen in his pull-up.",
            "He can get cranky if he does not have food available.",
          ],
        },
        {
          id: "activities",
          title: "Activities & Preferences",
          items: [
            "Preferred activities include walks, scooter riding, swimming, swinging, jumping, crashing, obstacle courses, chase, bowling, basketball, and horseback riding, car rides, exploring, hikes, malls, museums, stores, and walking around new places, animals, farms, dinosaurs, cars, trucks, books, and planets, spending time with family, and cupcakes, cake, frosting, sprinkles, and candy.",
            "He especially enjoys videos, YouTube, and sometimes sitting on the couch to watch TV.",
            "One of his biggest favorites is horseback riding.",
            "Mom is his favorite person.",
            "He may use his iPad to indicate he needs support.",
          ],
        },
        {
          id: "signs",
          title: "Signs They Are Having a Hard Time",
          items: [
            "Agitation, angry sounds, angry yelling, eloping or running away, and hand biting are signs he may need help.",
            "Hiding or grunting may mean they are having a bowel movement.",
            "Going to the fridge repeatedly for cheese can be a sign that he is hungry and needs help.",
            "He may sign for help to indicate he needs support.",
            "Let him have time alone when he is having a hard time.",
            "Reduce stimulation when he is having a hard time.",
            "He may press help on his AAC device to indicate he needs support.",
            "When Gavin goes to his AAC device and presses help, it means he needs help.",
          ],
        },
        {
          id: "supports",
          title: "What helps when they are having a hard time",
          items: [
            "Preferred activities include walks, scooter riding, swimming, swinging, jumping, crashing, obstacle courses, chase, bowling, basketball, and horseback riding, car rides, exploring, hikes, malls, museums, stores, and walking around new places, animals, farms, dinosaurs, cars, trucks, books, and planets, spending time with family, and cupcakes, cake, frosting, sprinkles, and candy.",
            "A car ride can help him reset.",
            "A quiet environment can help him calm down.",
            "A visual schedule with a preferred item or preferred activity at the end is helpful for transitions.",
            "Candy such as Swedish Fish or gummies can sometimes help redirect him when he is having a hard time.",
            "Do not crowd him.",
            "Do not try to physically stop hand biting because he may bite you.",
            "Give him space when he is having a hard time.",
            "Gummy candy can help sometimes when he is having a hard time.",
            "If he is still somewhat calm, prompt him to squeeze and release, take a deep breath, or count to 10.",
            "Keep the environment quiet when he is having a hard time.",
            "Make sure Gavin is safe when he is having a hard time.",
            "Swedish Fish or other gummies can motivate him during transitions.",
            "Swedish Fish can help sometimes when he is having a hard time.",
            "He uses noise-canceling headphones.",
          ],
        },
        {
          id: "health",
          title: "Health & Safety",
          items: [
            "He has Pica.",
            "He needs at least 2 adults for walks or outings for safety.",
            "He has Apraxia of Speech.",
            "Diagnoses and conditions: Autism Spectrum Disorder, Cerebral Visual Impairment (CVI), Pica, Language Regression, Mixed receptive-expressive language disorder, Global Developmental Delay, Apraxia of Speech, low muscle tone, and Sensory Processing Difficulty.",
            "He has Language Regression.",
            "Abilify is used for irritability, aggression, repetitive behaviors, and self-injury.",
            "Gavin gets MiraLax in water.",
            "He takes Abilify (Aripiprazole) 15 mg once daily at 3 p.m.",
            "He also takes L'il Critters Gummy Vites multivitamin, 2 gummies per day.",
            "He takes Polyethylene glycol 3350 / MiraLax daily in water to keep stool regular.",
            "He uses pull-ups.",
            "He uses a Buckle Buddy for seat belt safety and is buckled in with it.",
            "He uses a white cane and is learning to use it.",
            "He uses fidgets.",
            "Emergency contact: Labebe Awde, grandmother, 617-930-7229.",
            "Emergency contact: Rania Kelly, mother with physical custody, 617-538-4056.",
          ],
        },
      ],
    }),
    "Gavin",
  );

  assert.equal(normalized.caregiverInsights?.length, 1);
  assert.doesNotMatch(normalized.overview, /Best Supports: Preferred activities include/i);
  assert.match(
    normalized.overview,
    /Best Supports: .*(space|quiet|car ride|visual schedule)/i,
  );

  const learning = sectionText(normalized, "Understanding and Learning");
  assert.match(learning, /2-step|two-step/i);
  assert.match(learning, /first this, then that/i);
  assert.match(learning, /very visual/i);
  assert.match(learning, /pictures/i);
  assert.match(learning, /actual items/i);
  assert.match(learning, /gentle physical cues/i);
  assert.match(learning, /Tapping Gavin's foot/i);
  assert.doesNotMatch(learning, /Sensory Processing Difficulty/i);

  const signs = sectionText(normalized, "Signs They Need Help");
  assert.doesNotMatch(signs, /time alone|Reduce stimulation|Abilify|Aripiprazole|MiraLax|polyethylene glycol|multivitamin/i);
  assert.equal(countSectionMatches(normalized, "Signs They Need Help", /press(?:es)? help/i), 1);

  const supports = sectionText(normalized, "What Helps When They Are Having a Hard Time");
  assert.match(supports, /car ride/i);
  assert.match(supports, /quiet/i);
  assert.match(supports, /visual schedule/i);
  assert.match(supports, /squeeze and release|deep breath|count to 10/i);
  assert.match(supports, /Swedish Fish|gummies|candy/i);
  assert.doesNotMatch(supports, /^Preferred activities include/im);
  assert.equal(countSectionMatches(normalized, "What Helps When They Are Having a Hard Time", /Swedish Fish|gumm|candy/i), 1);

  const health = sectionText(normalized, "Health & Safety");
  assert.match(health, /Sensory Processing Difficulty/i);
  assert.match(health, /Abilify.*aripiprazole/i);
  assert.match(health, /polyethylene glycol.*MiraLax|MiraLax.*polyethylene glycol/i);
  assert.match(health, /Gummy Vites|multivitamin/i);
  assert.match(health, /Buckle Buddy/i);
  assert.match(health, /white cane/i);
  assert.match(health, /pull-ups/i);
  assert.match(health, /fidgets/i);
  assert.match(health, /noise-canceling headphones/i);
  assert.match(health, /Labebe Awde/i);
  assert.match(health, /Rania Kelly/i);
  const healthItems = sectionItems(normalized, "Health & Safety");
  assert.match(healthItems.at(-2) ?? "", /Emergency contact: .*Labebe Awde/i);
  assert.match(healthItems.at(-1) ?? "", /Emergency contact: .*Rania Kelly/i);
}

function testSevenSectionSummaryOutputs() {
  const summary = summaryWithVersions([], {
    caregiverInsights: [
      {
        insightId: "visual-learning-pattern",
        section: "Understanding and Learning",
        statement:
          "Jay is a highly visual learner who learns best through videos, modeling, visual schedules, and First-Then language.",
        supportingFactIds: ["entry-1-fact-1", "entry-2-fact-1"],
        themes: ["visual learning"],
      },
    ],
  });
  const plainText = summaryToPlainText(summary);
  const emailHtml = buildSummaryEmailHtml(summary);

  assert.match(plainText, /Caregiver Insights/);
  assert.match(plainText, /highly visual learner/i);
  assert.match(plainText, /About Jay/);
  assert.ok(
    plainText.indexOf("About Jay") < plainText.indexOf("Communication: Uses short phrases."),
    "expected About to appear before the overview in plain text",
  );
  assert.match(emailHtml, /Caregiver Insights/);
  assert.match(emailHtml, /highly visual learner/i);
  assert.match(emailHtml, /About Jay/);

  for (const heading of expectedSections) {
    assert.match(plainText, new RegExp(heading.replace("&", "\\&")));
    assert.match(emailHtml, new RegExp(heading.replace("&", "&amp;")));
  }

  for (const retiredHeading of [
    "Daily Needs & Routines",
    "What helps the day go well",
    "Who to contact (and when)",
  ]) {
    assert.doesNotMatch(plainText, new RegExp(retiredHeading.replace("&", "\\&")));
    assert.doesNotMatch(emailHtml, new RegExp(retiredHeading.replace("&", "&amp;")));
  }
}

function testCurrentStructuredBlocksArePreserved() {
  const summary = summaryWithVersions([]);
  summary.sections = summary.sections.map((section) =>
    section.title === "Health & Safety"
      ? {
          ...section,
          intro: "Important health details.",
          items: ["Primary contact: Maya"],
          blocks: [
            {
              type: "keyValue" as const,
              rows: [{ label: "Primary contact", value: "Maya" }],
            },
          ],
        }
      : section,
  );

  const normalized = normalizeAuthoritativeStructuredSummary(summary);
  const health = normalized.sections.find(
    (section) => section.title === "Health & Safety",
  );

  assert.equal(health?.intro, "Important health details.");
  assert.deepEqual(health?.blocks, [
    {
      type: "keyValue",
      rows: [{ label: "Primary contact", value: "Maya" }],
    },
  ]);

  const groupedSummary = summaryWithVersions([], {
    sections: expectedSections.map((title, index) => ({
      id: `grouped-${index + 1}`,
      title,
      items:
        title === "Food and Meals"
          ? ["Foods include pasta and green beans."]
          : ["(No information provided)."],
      blocks:
        title === "Food and Meals"
          ? [
              {
                type: "labeledBullets" as const,
                groups: [
                  {
                    label: "Food and drink notes",
                    items: ["Foods include pasta and green beans."],
                  },
                ],
              },
            ]
          : undefined,
    })),
  });
  const plainText = summaryToPlainText(groupedSummary);
  assert.match(plainText, /Food and drink notes\n- Foods include pasta and green beans\./);
  assert.doesNotMatch(plainText, /- Food and drink notes: Foods include/i);
}

function testFallbackAndRawCaptureRouting() {
  const prompts = getQuestionnairePrompts("english");
  const promptById = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  const currentAnswers = [
    ["understanding-learning-process", "She learns best by watching first."],
    [
      "hard-time-signs-situations-changes",
      "Unexpected changes and crowded rooms are difficult.",
    ],
    [
      "health-safety-contact-guidance",
      "Call Maya first and call 911 for breathing trouble.",
    ],
  ] as const;
  const turns = currentAnswers.flatMap(([promptId, content], index) => {
    const prompt = promptById.get(promptId)!;
    return responseTurns(
      promptId,
      prompt.question,
      content,
      `2026-06-01T12:0${index}:00.000Z`,
    ).map((turn) => ({
      ...turn,
      sectionId: prompt.sectionId,
      sectionTitle: prompt.sectionTitle,
      stepId: prompt.stepId,
      stepTitle: prompt.stepTitle,
      promptLabel: prompt.promptLabel,
    }));
  });

  const fallback = buildFallbackSummary(turns, "Jay");
  assert.deepEqual(
    fallback.sections.map((section) => section.title),
    expectedSections,
  );
  assert.ok(
    fallback.sections
      .find((section) => section.title === "Understanding and Learning")
      ?.items.some((item) => item.includes("watching")),
  );
  assert.ok(
    fallback.sections
      .find((section) => section.title === "Health & Safety")
      ?.items.some((item) => item.includes("Call Maya")),
  );

  const rawTurn: ConversationTurn = {
    id: "raw-document",
    role: "user",
    promptType: "section_prompt",
    content:
      "How do they learn, understand, and process information? Learns by watching.\n\n" +
      "What activities do they enjoy most? Music and drawing.\n\n" +
      "If something happens, who should be contacted and what should others know about when to call? Call Maya first.",
    createdAt: "2026-06-01T12:10:00.000Z",
  };
  const expanded = expandTurnsForSummaryCapture([rawTurn]);
  assert.deepEqual(
    expanded.map((turn) => turn.sectionTitle),
    [
      "Understanding and Learning",
      "Activities & Preferences",
      "Health & Safety",
    ],
  );

  const legacyRawTurn: ConversationTurn = {
    ...rawTurn,
    id: "legacy-raw-document",
    content:
      "What helps with transitions during the day? Use a visual timer.\n\n" +
      "What changes in plans or routine tend to upset or overwhelm them? Unexpected changes.\n\n" +
      "Who should be contacted in an emergency? Call Maya first.",
  };
  assert.deepEqual(
    expandTurnsForSummaryCapture([legacyRawTurn]).map(
      (turn) => turn.sectionTitle,
    ),
    [
      "What helps when they are having a hard time",
      "Signs They Are Having a Hard Time",
      "Health & Safety",
    ],
  );
}

function testSummaryFreshnessVersions() {
  const turns = responseTurns(
    "communication-how-do-they-communicate",
    "How do they communicate?",
    "Uses short phrases.",
    "2026-06-01T12:00:00.000Z",
  );
  const current = summaryWithVersions(turns);
  const stale = summaryWithVersions(turns, {
    pipelineVersion: "2026-03-17-v2",
    layoutVersion: "2026-03-17-v2",
  });

  assert.deepEqual(getSummaryFreshness(turns, current, current), {
    generated: "fresh",
    edited: "fresh",
    requiresRegeneration: false,
  });
  assert.deepEqual(getSummaryFreshness(turns, stale, stale), {
    generated: "stale",
    edited: "stale",
    requiresRegeneration: true,
  });

  const draft = {
    ...makeDraft(turns),
    structuredSummary: stale,
    editedSummary: stale,
  };
  const archived = archiveDraftSummaries(
    draft,
    "2026-06-01T12:10:00.000Z",
  );
  assert.equal(archived.structuredSummary, stale);
  assert.equal(archived.editedSummary, stale);
  assert.deepEqual(archived.summaryArchives, [
    {
      structuredSummary: stale,
      editedSummary: stale,
      archivedAt: "2026-06-01T12:10:00.000Z",
      reason: "stale_regeneration",
    },
  ]);
  assert.deepEqual(
    archiveDraftSummaries(archived, "2026-06-01T12:11:00.000Z"),
    archived,
  );
}

function testReviewedSummaryEditsSurviveRegeneration() {
  const turns = responseTurns(
    "communication-how-do-they-communicate",
    "How do they communicate?",
    "Verbally",
    "2026-04-30T16:19:33.307Z",
  );
  const metadata = summaryWithVersions(turns, {
    title: "Caring for Dylan",
  });
  const previousGenerated: StructuredSummary = {
    ...metadata,
    caregiverInsights: [
      {
        insightId: "communication-pattern",
        section: "Communication",
        statement: "Dylan communicates verbally.",
        supportingFactIds: ["entry-1-fact-1", "entry-2-fact-1"],
        themes: ["communication"],
      },
    ],
    sections: [
      {
        id: "communication",
        title: "Communication",
        items: ["Communicates verbally."],
      },
      {
        id: "daily",
        title: "Daily Needs & Routines",
        items: ["(No information provided)"],
      },
      {
        id: "day-go-well",
        title: "What helps the day go well",
        items: ["Use a timer."],
      },
      {
        id: "triggers",
        title: "What can upset or overwhelm them",
        items: ["(No information provided)"],
      },
      {
        id: "signs",
        title: "Signs they need help",
        items: ["(No information provided)"],
      },
      {
        id: "supports",
        title: "What helps when they are having a hard time",
        items: ["(No information provided)"],
      },
      {
        id: "health",
        title: "Health & Safety",
        items: ["(No information provided)"],
      },
      {
        id: "contacts",
        title: "Who to contact (and when)",
        items: [
          "Contact Dotty Foley, parent and guardian, in an emergency.",
          "Contact Teirza Peirce for non-emergencies.",
        ],
      },
    ],
  };
  const previousEdited: StructuredSummary = {
    ...previousGenerated,
    caregiverInsights: [
      {
        insightId: "communication-pattern",
        section: "Communication",
        statement: "Dylan communicates verbally and benefits from patient conversation.",
        supportingFactIds: ["entry-1-fact-1", "entry-2-fact-1"],
        themes: ["communication"],
      },
    ],
    sections: previousGenerated.sections.map((section) => {
      if (section.title === "What helps the day go well") {
        return {
          ...section,
          items: ["Visual schedule with words."],
        };
      }

      if (section.title === "What helps when they are having a hard time") {
        return {
          ...section,
          items: ["Space by himself."],
        };
      }

      return section;
    }),
  };
  const current = summaryWithVersions(turns, {
    title: "Caring for Dylan",
    caregiverInsights: [
      {
        insightId: "communication-pattern",
        section: "Communication",
        statement: "Dylan communicates verbally.",
        supportingFactIds: ["entry-3-fact-1", "entry-4-fact-1"],
        themes: ["communication"],
      },
    ],
    sections: expectedSections.map((title, index) => ({
      id: `current-${index + 1}`,
      title,
      items:
        title === "Communication"
          ? ["They communicate verbally."]
          : title === "Health & Safety"
            ? [
                "Dotty Foley, parent and guardian, is the emergency contact.",
                "Teirza Peirce is the non-emergency contact.",
              ]
            : title === "What Helps When They Are Having a Hard Time"
              ? ["Use a timer."]
              : ["(No information provided)."],
    })),
  });

  const merged = applyReviewedSummaryEdits(
    current,
    previousGenerated,
    previousEdited,
    "Dylan",
  );
  const supports = sectionText(
    merged,
    "What Helps When They Are Having a Hard Time",
  );

  assert.match(supports, /Visual schedule with words/i);
  assert.match(supports, /Space by himself/i);
  assert.doesNotMatch(supports, /Use a timer/i);
  assert.match(
    sectionText(merged, "Health & Safety"),
    /Dotty Foley.*emergency contact/i,
  );
  assert.match(
    sectionText(merged, "Health & Safety"),
    /Teirza Peirce.*non-emergency contact/i,
  );
  assert.match(
    merged.overview,
    /Emergency Contact: Dotty Foley.*parent and guardian/i,
  );
  assert.doesNotMatch(merged.overview, /Emergency Contact: Emergency contact:/i);
  assert.match(
    merged.caregiverInsights?.[0]?.statement ?? "",
    /patient conversation/i,
  );
}

function testReviewedAboutSectionEditsSurviveRegeneration() {
  const aboutSection = (
    intro: string,
    item: string,
    id = "about-1",
  ) => ({
    id,
    title: "About",
    intro,
    items: [item],
    blocks: [{ type: "bullets" as const, items: [item] }],
  });
  const sectionsWithAbout = (intro: string, item: string) =>
    expectedSections.map((title, index) =>
      title === "About"
        ? aboutSection(intro, item)
        : {
            id: `section-${index + 1}`,
            title,
            items: ["(No information provided)"],
          },
    );
  const previousGenerated = summaryWithVersions([], {
    title: "Caring for Gavin",
    sections: sectionsWithAbout(
      "Gavin is curious and enjoys exploration.",
      "Gavin enjoys exploring new places.",
    ),
  });
  const previousEdited = summaryWithVersions([], {
    title: "Caring for Gavin",
    sections: sectionsWithAbout(
      "Gavin is curious, observant, and ready for new experiences.",
      "A new caregiver should know Gavin understands more than speech alone shows.",
    ),
  });
  const current = summaryWithVersions([], {
    title: "Caring for Gavin",
    sections: sectionsWithAbout(
      "Gavin is curious and enjoys exploration.",
      "Generated new About text.",
    ),
  });

  const merged = applyReviewedSummaryEdits(
    current,
    previousGenerated,
    previousEdited,
    "Gavin",
  );
  const about = merged.sections.find((section) => section.title === "About");

  assert.equal(
    about?.intro,
    "Gavin is curious, observant, and ready for new experiences.",
  );
  assert.match(sectionText(merged, "About"), /understands more than speech/i);
  assert.doesNotMatch(sectionText(merged, "About"), /Generated new About text/i);
}

async function testRecordingStopSequence() {
  const audioBlob = new Blob(["audio"], { type: "audio/wav" });

  for (const autoStopped of [false, true]) {
    let stopCount = 0;
    let chimeCount = 0;
    let transcriptionCount = 0;
    const result = await processStoppedRecording({
      recorder: {
        async stop() {
          stopCount += 1;
          return { blob: audioBlob, durationMs: 60_000 };
        },
        async cancel() {},
      },
      chime: {
        async play() {
          chimeCount += 1;
        },
        async close() {},
      },
      autoStopped,
      onRecordingStopped() {},
      async transcribe(blob) {
        assert.equal(blob, audioBlob);
        transcriptionCount += 1;
      },
    });

    assert.equal(result, "transcribed");
    assert.equal(stopCount, 1);
    assert.equal(chimeCount, autoStopped ? 1 : 0);
    assert.equal(transcriptionCount, 1);
  }

  let transcriptionCount = 0;
  await processStoppedRecording({
    recorder: {
      async stop() {
        return { blob: audioBlob, durationMs: 60_000 };
      },
      async cancel() {},
    },
    chime: {
      async play() {
        throw new Error("Playback blocked");
      },
      async close() {},
    },
    autoStopped: true,
    onRecordingStopped() {},
    async transcribe() {
      transcriptionCount += 1;
    },
  });
  assert.equal(transcriptionCount, 1);
}

async function main() {
  testQuestionnaireContract();
  testStructuredCompletionParsing();
  await testSummaryCaptureBatchingWithMockedModel();
  await testGuideLayoutGroupingWithMockedFacts();
  testEveryLegacyPromptMapping();
  testLegacyDraftMigration();
  testHealthMappingAndSkippedMigration();
  testSevenSectionSummaryNormalization();
  testSummaryRoutingAndCleanup();
  testPastedGavinSummaryCleanup();
  testSevenSectionSummaryOutputs();
  testCurrentStructuredBlocksArePreserved();
  testFallbackAndRawCaptureRouting();
  testSummaryFreshnessVersions();
  testReviewedSummaryEditsSurviveRegeneration();
  testReviewedAboutSectionEditsSurviveRegeneration();
  await testRecordingStopSequence();
  console.log("Questionnaire, recording, and guide-layout summary tests passed.");
}

void main();
