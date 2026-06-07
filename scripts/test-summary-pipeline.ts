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
const expectedSections = [
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
    expectedSections,
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
                  facts: entryIds.map((entryId) => ({
                    entryId,
                    section: "Communication",
                    factKind: "communication_method",
                    subcategory: "General",
                    statement: `${entryId} includes a communication detail.`,
                    safetyRelevant: false,
                  })),
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
    assert.equal(result.summary.sections.length, 7);
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
          section.title === "Signs They Are Having a Hard Time",
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
    sectionText(normalized, "Signs They Are Having a Hard Time"),
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
    sectionText(normalized, "Daily Schedule"),
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
    "What helps when they are having a hard time",
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
    sectionItems(normalized, "Signs They Are Having a Hard Time").filter(
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
      "What helps when they are having a hard time",
    ),
    "Signs They Are Having a Hard Time",
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "Eloping is a sign they need help.",
      "What helps when they are having a hard time",
    ),
    "Signs They Are Having a Hard Time",
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "They are not eating or drinking.",
      "What helps when they are having a hard time",
    ),
    "Signs They Are Having a Hard Time",
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "Behavior or communication signs include hand biting, angry vocalizations, and pressing Help.",
      "Communication",
    ),
    "Signs They Are Having a Hard Time",
  );
  assert.equal(
    inferAuthoritativeSectionTitle(
      "Do not block hand biting because they may bite the caregiver.",
      "Signs They Are Having a Hard Time",
    ),
    "What helps when they are having a hard time",
  );

  const activities = sectionItems(normalized, "Activities & Preferences");
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

function testSevenSectionSummaryOutputs() {
  const summary = summaryWithVersions([]);
  const plainText = summaryToPlainText(summary);
  const emailHtml = buildSummaryEmailHtml(summary);

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
            : title === "What helps when they are having a hard time"
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
    "What helps when they are having a hard time",
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
  testEveryLegacyPromptMapping();
  testLegacyDraftMigration();
  testHealthMappingAndSkippedMigration();
  testSevenSectionSummaryNormalization();
  testSummaryRoutingAndCleanup();
  testSevenSectionSummaryOutputs();
  testCurrentStructuredBlocksArePreserved();
  testFallbackAndRawCaptureRouting();
  testSummaryFreshnessVersions();
  testReviewedSummaryEditsSurviveRegeneration();
  await testRecordingStopSequence();
  console.log("Questionnaire, recording, and seven-section summary tests passed.");
}

void main();
