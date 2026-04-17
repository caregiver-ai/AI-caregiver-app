import { loadEnvConfig } from "@next/env";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { generateCaregiverSummary, SummaryGenerationMode } from "../lib/summary-generation";
import { PREFERRED_SUMMARY_SECTION_ORDER } from "../lib/summary";
import { ConversationTurn, StructuredSummary } from "../lib/types";

type PhraseCheck = {
  label: string;
  anyOf: string[];
};

type BenchmarkFixture = {
  id: string;
  nameHint?: string;
  turns: ConversationTurn[];
  expectations: {
    overviewChecks?: PhraseCheck[];
    sectionChecks?: Partial<Record<(typeof PREFERRED_SUMMARY_SECTION_ORDER)[number], PhraseCheck[]>>;
    bannedPhrases?: string[];
    maxDuplicateItems?: number;
  };
};

type EvaluationResult = {
  label: string;
  passedChecks: number;
  totalChecks: number;
  failures: string[];
  duplicateCount: number;
};

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function contentTokens(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(" ")
    .filter((token) => token.length > 2);
}

function itemsAreNearDuplicate(left: string, right: string) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  if (
    normalizedLeft.length >= 24 &&
    normalizedRight.length >= 24 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  ) {
    return true;
  }

  const leftTokens = contentTokens(left);
  const rightTokens = contentTokens(right);

  if (leftTokens.length < 4 || rightTokens.length < 4) {
    return false;
  }

  const overlapCount = leftTokens.filter((token) => rightTokens.includes(token)).length;
  const unionCount = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = unionCount === 0 ? 0 : overlapCount / unionCount;

  return jaccard >= 0.75;
}

function containsAny(haystack: string, needles: string[]) {
  const normalizedHaystack = normalizeText(haystack);
  return needles.some((needle) => normalizedHaystack.includes(normalizeText(needle)));
}

function duplicateItemCount(summary: StructuredSummary) {
  const seen: string[] = [];
  let duplicates = 0;

  for (const item of summary.sections.flatMap((section) => section.items)) {
    const normalizedItem = normalizeText(item);
    if (!normalizedItem || normalizedItem === normalizeText("(No information provided)")) {
      continue;
    }

    if (seen.some((existing) => itemsAreNearDuplicate(item, existing))) {
      duplicates += 1;
      continue;
    }

    seen.push(item);
  }

  return duplicates;
}

function evaluateSummary(
  summary: StructuredSummary,
  fixture: BenchmarkFixture,
  label: string
): EvaluationResult {
  const failures: string[] = [];
  let passedChecks = 0;
  let totalChecks = 0;

  for (const title of PREFERRED_SUMMARY_SECTION_ORDER) {
    totalChecks += 1;
    if (summary.sections.some((section) => section.title === title)) {
      passedChecks += 1;
    } else {
      failures.push(`Missing section: ${title}`);
    }
  }

  for (const check of fixture.expectations.overviewChecks ?? []) {
    totalChecks += 1;
    if (containsAny(summary.overview, check.anyOf)) {
      passedChecks += 1;
    } else {
      failures.push(`Overview missing: ${check.label}`);
    }
  }

  for (const title of PREFERRED_SUMMARY_SECTION_ORDER) {
    const section = summary.sections.find((entry) => entry.title === title);
    const text = section?.items.join(" \n ") ?? "";

    for (const check of fixture.expectations.sectionChecks?.[title] ?? []) {
      totalChecks += 1;
      if (containsAny(text, check.anyOf)) {
        passedChecks += 1;
      } else {
        failures.push(`${title}: missing ${check.label}`);
      }
    }
  }

  for (const phrase of fixture.expectations.bannedPhrases ?? []) {
    totalChecks += 1;
    const matchesBannedPhrase =
      containsAny(summary.overview, [phrase]) ||
      summary.sections.some((section) => containsAny(section.items.join(" \n "), [phrase]));

    if (!matchesBannedPhrase) {
      passedChecks += 1;
    } else {
      failures.push(`Contains banned phrase: ${phrase}`);
    }
  }

  const duplicates = duplicateItemCount(summary);
  if (typeof fixture.expectations.maxDuplicateItems === "number") {
    totalChecks += 1;
    if (duplicates <= fixture.expectations.maxDuplicateItems) {
      passedChecks += 1;
    } else {
      failures.push(
        `Duplicate items: ${duplicates} exceeds max ${fixture.expectations.maxDuplicateItems}`
      );
    }
  }

  return {
    label,
    passedChecks,
    totalChecks,
    failures,
    duplicateCount: duplicates
  };
}

function printEvaluation(result: EvaluationResult) {
  console.log(
    `  ${result.label}: ${result.passedChecks}/${result.totalChecks} checks passed, duplicates=${result.duplicateCount}`
  );

  for (const failure of result.failures) {
    console.log(`    - ${failure}`);
  }
}

async function loadFixtures(fixturesDir: string) {
  const entries = await readdir(fixturesDir);

  return Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map(async (entry) => {
        const filePath = path.join(fixturesDir, entry);
        const content = await readFile(filePath, "utf8");
        return JSON.parse(content) as BenchmarkFixture;
      })
  );
}

async function runMode(
  fixture: BenchmarkFixture,
  mode: SummaryGenerationMode
): Promise<EvaluationResult> {
  const summary = await generateCaregiverSummary(fixture.turns, fixture.nameHint, mode);
  return evaluateSummary(summary, fixture, mode);
}

async function main() {
  const projectRoot = process.cwd();
  loadEnvConfig(projectRoot);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to run summary benchmarks.");
  }

  const fixturesDir = path.join(projectRoot, "benchmarks", "summary", "fixtures");
  const fixtures = await loadFixtures(fixturesDir);

  if (fixtures.length === 0) {
    throw new Error("No benchmark fixtures found.");
  }

  let hasFailures = false;

  for (const fixture of fixtures) {
    console.log(`\nFixture: ${fixture.id}`);

    const oneStep = await runMode(fixture, "one-step");
    const twoStep = await runMode(fixture, "two-step");

    printEvaluation(oneStep);
    printEvaluation(twoStep);

    const scoreDelta = twoStep.passedChecks - oneStep.passedChecks;
    const duplicateDelta = oneStep.duplicateCount - twoStep.duplicateCount;
    console.log(
      `  delta: checks ${scoreDelta >= 0 ? "+" : ""}${scoreDelta}, duplicates ${
        duplicateDelta >= 0 ? "-" : "+"
      }${Math.abs(duplicateDelta)}`
    );

    if (twoStep.failures.length > 0) {
      hasFailures = true;
    }
  }

  if (hasFailures) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
