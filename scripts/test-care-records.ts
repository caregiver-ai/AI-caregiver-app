import assert from "node:assert/strict";
import {
  CARE_RECORD_CATEGORY_IDS,
  buildFallbackCareRecordSuggestions,
  groupCareRecordItemsByCategory,
  normalizeCareRecordCategory,
  normalizeCareRecordFields,
  normalizeCareRecordItemInput,
  normalizeCareRecordSuggestions,
  parseCareRecordExtractionText
} from "../lib/care-records";

function testCategoryNormalization() {
  assert.equal(normalizeCareRecordCategory("health_insurance"), "health_insurance");
  assert.equal(normalizeCareRecordCategory("LEGAL_DECISION_MAKING"), "legal_decision_making");
  assert.equal(normalizeCareRecordCategory("unknown"), "important_people");
  assert.equal(CARE_RECORD_CATEGORY_IDS.length, 5);
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
    '```json\n{"items":[{"category":"support_government","title":"DDS","fields":[{"label":"Agency","value":"DDS"}],"notes":""}]}\n```'
  );
  const suggestions = normalizeCareRecordSuggestions(parsed, "typed", "Typed entry");

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].category, "support_government");
  assert.equal(suggestions[0].sourceType, "typed");
  assert.equal(suggestions[0].sourceLabel, "Typed entry");
}

function testInputNormalization() {
  const input = normalizeCareRecordItemInput({
    category: "financial_advisors",
    title: " ABLE Account ",
    fields: [{ label: "Location", value: "Blue folder" }],
    notes: "Reviewed",
    sourceType: "pdf",
    sourceLabel: "benefits.pdf"
  });

  assert.deepEqual(input, {
    category: "financial_advisors",
    title: "ABLE Account",
    fields: [{ label: "Location", value: "Blue folder" }],
    notes: "Reviewed",
    sourceType: "pdf",
    sourceLabel: "benefits.pdf"
  });
}

function testFallbackAndGrouping() {
  const suggestions = buildFallbackCareRecordSuggestions("Dr. Smith handles medication changes.");
  assert.equal(suggestions[0].category, "health_insurance");

  const grouped = groupCareRecordItemsByCategory([
    { category: "health_insurance", value: "one" },
    { category: "important_people", value: "two" }
  ]);

  assert.equal(grouped.length, 5);
  assert.equal(grouped.find((group) => group.id === "health_insurance")?.items.length, 1);
  assert.equal(grouped.find((group) => group.id === "important_people")?.items.length, 1);
}

function run() {
  testCategoryNormalization();
  testFieldNormalization();
  testExtractionParsingAndSuggestions();
  testInputNormalization();
  testFallbackAndGrouping();
  console.log("Care Records tests passed.");
}

run();
