import assert from "node:assert/strict";
import {
  CARE_RECORD_CATEGORY_IDS,
  LEGACY_CARE_RECORD_CATEGORY_MAP,
  buildFallbackCareRecordSuggestions,
  groupCareRecordItemsByCategory,
  hasCareRecordContent,
  normalizeApprovedCareRecordInputs,
  normalizeCareRecordCategory,
  normalizeCareRecordFields,
  normalizeCareRecordItemInput,
  normalizeCareRecordSuggestions,
  parseCareRecordExtractionText
} from "../lib/care-records";

function testCategoryNormalization() {
  assert.equal(normalizeCareRecordCategory("health_care"), "health_care");
  assert.equal(normalizeCareRecordCategory("LEGAL_DECISION_MAKING"), "legal_decision_making");
  assert.equal(normalizeCareRecordCategory("health_insurance"), "health_care");
  assert.equal(normalizeCareRecordCategory("support_government"), "support_services");
  assert.equal(normalizeCareRecordCategory("financial_advisors"), "financial_resources");
  assert.equal(normalizeCareRecordCategory("unknown"), "important_people");
  assert.equal(CARE_RECORD_CATEGORY_IDS.length, 9);
  assert.deepEqual(LEGACY_CARE_RECORD_CATEGORY_MAP, {
    health_insurance: "health_care",
    support_government: "support_services",
    financial_advisors: "financial_resources"
  });
}

function testFieldNormalization() {
  assert.deepEqual(
    normalizeCareRecordFields([
      { label: " Doctor ", value: " Dr. Patel " },
      { label: "", value: "ignored" },
      { label: "Phone", value: "" }
    ]),
    [{ label: "Doctor", value: "Dr. Patel" }]
  );
}

function testExtractionParsingAndSuggestions() {
  const parsed = parseCareRecordExtractionText(
    '```json\n{"items":[{"category":"government_resources","title":"DDS","fields":[{"label":"Agency","value":"DDS"}],"notes":""}]}\n```'
  );
  const suggestions = normalizeCareRecordSuggestions(parsed, "typed", "Typed entry");

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].category, "government_resources");
  assert.equal(suggestions[0].sourceType, "typed");
  assert.equal(suggestions[0].sourceLabel, "Typed entry");
}

function testInputNormalization() {
  const input = normalizeCareRecordItemInput({
    category: "financial_resources",
    title: " ABLE Account ",
    fields: [{ label: "Location", value: "Blue folder" }],
    notes: "Reviewed",
    sourceType: "pdf",
    sourceLabel: "benefits.pdf"
  });

  assert.deepEqual(input, {
    category: "financial_resources",
    title: "ABLE Account",
    fields: [{ label: "Location", value: "Blue folder" }],
    notes: "Reviewed",
    sourceType: "pdf",
    sourceLabel: "benefits.pdf"
  });
}

function testSavePayloadShape() {
  const normalized = normalizeApprovedCareRecordInputs([
    {
      category: "documents",
      title: " Empty shell ",
      fields: [{ label: "Location", value: "" }],
      notes: "",
      sourceType: "typed",
      sourceLabel: "Typed entry"
    },
    {
      category: "health_insurance",
      title: "Health plan",
      fields: [{ label: "Plan", value: "Blue Cross" }],
      notes: "",
      sourceType: "pdf",
      sourceLabel: "Uploaded PDF"
    }
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].category, "health_care");
  assert.deepEqual(normalized[0].fields, [{ label: "Plan", value: "Blue Cross" }]);
  assert.equal(hasCareRecordContent(normalized[0]), true);
  assert.equal(
    hasCareRecordContent({
      fields: [],
      notes: ""
    }),
    false
  );
}

function testFallbackAndGrouping() {
  const suggestions = buildFallbackCareRecordSuggestions("Dr. Smith handles medication changes.");
  assert.equal(suggestions[0].category, "health_care");

  const grouped = groupCareRecordItemsByCategory([
    { category: "health_care", value: "one" },
    { category: "important_people", value: "two" }
  ]);

  assert.equal(grouped.length, 9);
  assert.equal(grouped.find((group) => group.id === "health_care")?.items.length, 1);
  assert.equal(grouped.find((group) => group.id === "important_people")?.items.length, 1);
}

function run() {
  testCategoryNormalization();
  testFieldNormalization();
  testExtractionParsingAndSuggestions();
  testInputNormalization();
  testSavePayloadShape();
  testFallbackAndGrouping();
  console.log("Care Records tests passed.");
}

run();
