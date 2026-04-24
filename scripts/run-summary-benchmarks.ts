import { loadEnvConfig } from "@next/env";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getVisibleSections, sectionToSearchText, summaryToSearchText } from "../lib/summary-display";
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
    sectionTitles?: string[];
    sectionChecks?: Record<string, PhraseCheck[]>;
    bannedPhrases?: string[];
    maxDuplicateItems?: number;
    sectionBannedPhrases?: Record<string, string[]>;
    maxDuplicateItemsBySection?: Record<string, number>;
  };
};

type EvaluationResult = {
  label: string;
  passedChecks: number;
  totalChecks: number;
  failures: string[];
  duplicateCount: number;
};

type AggregateEvaluationResult = {
  label: string;
  runs: EvaluationResult[];
  worstPassedChecks: number;
  totalChecks: number;
  maxDuplicateCount: number;
  failedRuns: number;
  failureCounts: Map<string, number>;
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

function duplicateCountForItems(items: string[]) {
  const seen: string[] = [];
  let duplicates = 0;

  for (const item of items) {
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
  const expectedSectionTitles = fixture.expectations.sectionTitles ?? [...PREFERRED_SUMMARY_SECTION_ORDER];
  const visibleSections = getVisibleSections(summary);
  const sectionsByTitle = new Map(
    visibleSections.map((section) => [normalizeText(section.title), section] as const)
  );

  for (const title of expectedSectionTitles) {
    totalChecks += 1;
    if (sectionsByTitle.has(normalizeText(title))) {
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

  for (const [title, checks] of Object.entries(fixture.expectations.sectionChecks ?? {})) {
    const section = sectionsByTitle.get(normalizeText(title));
    const text = section ? sectionToSearchText(section) : "";

    for (const check of checks) {
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
    const matchesBannedPhrase = containsAny(summaryToSearchText(summary), [phrase]);

    if (!matchesBannedPhrase) {
      passedChecks += 1;
    } else {
      failures.push(`Contains banned phrase: ${phrase}`);
    }
  }

  for (const [title, phrases] of Object.entries(fixture.expectations.sectionBannedPhrases ?? {})) {
    const section = sectionsByTitle.get(normalizeText(title));
    const text = section ? sectionToSearchText(section) : "";

    for (const phrase of phrases) {
      totalChecks += 1;
      if (!containsAny(text, [phrase])) {
        passedChecks += 1;
      } else {
        failures.push(`${title}: contains banned phrase ${phrase}`);
      }
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

  for (const [title, maxDuplicates] of Object.entries(fixture.expectations.maxDuplicateItemsBySection ?? {})) {
    if (typeof maxDuplicates !== "number") {
      continue;
    }

    totalChecks += 1;
    const section = sectionsByTitle.get(normalizeText(title));
    const duplicateCount = duplicateCountForItems(section?.items ?? []);

    if (duplicateCount <= maxDuplicates) {
      passedChecks += 1;
    } else {
      failures.push(`${title}: duplicate items ${duplicateCount} exceeds max ${maxDuplicates}`);
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

function aggregateEvaluations(
  label: string,
  runs: EvaluationResult[]
): AggregateEvaluationResult {
  const failureCounts = new Map<string, number>();

  for (const result of runs) {
    for (const failure of result.failures) {
      failureCounts.set(failure, (failureCounts.get(failure) ?? 0) + 1);
    }
  }

  return {
    label,
    runs,
    worstPassedChecks: Math.min(...runs.map((result) => result.passedChecks)),
    totalChecks: runs[0]?.totalChecks ?? 0,
    maxDuplicateCount: Math.max(...runs.map((result) => result.duplicateCount)),
    failedRuns: runs.filter((result) => result.failures.length > 0).length,
    failureCounts
  };
}

function printAggregateEvaluation(result: AggregateEvaluationResult) {
  if (result.runs.length === 1) {
    printEvaluation(result.runs[0]);
    return;
  }

  for (const run of result.runs) {
    printEvaluation(run);
  }

  console.log(
    `  ${result.label} aggregate: worst ${result.worstPassedChecks}/${result.totalChecks} checks passed, failed_runs=${result.failedRuns}/${result.runs.length}, max_duplicates=${result.maxDuplicateCount}`
  );

  for (const [failure, count] of [...result.failureCounts.entries()].sort((left, right) => right[1] - left[1])) {
    console.log(`    - ${failure} (${count}/${result.runs.length} runs)`);
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
  mode: SummaryGenerationMode,
  runs: number
): Promise<AggregateEvaluationResult> {
  const results: EvaluationResult[] = [];

  for (let index = 0; index < runs; index += 1) {
    const summary = await generateCaregiverSummary(fixture.turns, fixture.nameHint, mode);
    results.push(evaluateSummary(summary, fixture, `${mode} run ${index + 1}`));
  }

  return aggregateEvaluations(mode, results);
}

async function main() {
  const projectRoot = process.cwd();
  loadEnvConfig(projectRoot);
  const hasModelKey = Boolean(process.env.OPENAI_API_KEY);

  if (!hasModelKey) {
    console.warn("OPENAI_API_KEY is not set. Running benchmarks against the local fallback summarizer.");
  }

  const fixturesDir = path.join(projectRoot, "benchmarks", "summary", "fixtures");
  const fixtures = await loadFixtures(fixturesDir);
  const benchmarkRuns = Math.max(1, Number.parseInt(process.env.SUMMARY_BENCHMARK_RUNS ?? "3", 10) || 1);

  if (fixtures.length === 0) {
    throw new Error("No benchmark fixtures found.");
  }

  let hasFailures = false;

  for (const fixture of fixtures) {
    console.log(`\nFixture: ${fixture.id}`);

    const oneStep = await runMode(fixture, "one-step", benchmarkRuns);
    const twoStep = await runMode(fixture, "two-step", benchmarkRuns);

    printAggregateEvaluation(oneStep);
    printAggregateEvaluation(twoStep);

    const scoreDelta = twoStep.worstPassedChecks - oneStep.worstPassedChecks;
    const duplicateDelta = oneStep.maxDuplicateCount - twoStep.maxDuplicateCount;
    console.log(
      `  delta: checks ${scoreDelta >= 0 ? "+" : ""}${scoreDelta}, duplicates ${
        duplicateDelta >= 0 ? "-" : "+"
      }${Math.abs(duplicateDelta)}`
    );

    if (twoStep.failedRuns > 0) {
      hasFailures = true;
    }
  }

  if (hasFailures && hasModelKey) {
    process.exitCode = 1;
    return;
  }

  if (hasFailures && !hasModelKey) {
    console.warn(
      "Fallback summarizer did not satisfy all benchmark checks. This does not fail the run without OPENAI_API_KEY."
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
