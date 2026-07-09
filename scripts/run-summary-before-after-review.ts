import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { generateCaregiverSummaryWithQa } from "../lib/summary-generation";
import { summaryToPlainText } from "../lib/summary";
import type { ConversationTurn, StructuredSummary, SummaryAuditIssue } from "../lib/types";

type ReviewCase = {
  label: string;
  nameHint: string;
  source: "session" | "raw-doc" | "fixture";
  sessionId?: string;
  rawDocPath?: string;
  turns?: ConversationTurn[];
};

type CaseMetrics = {
  label: string;
  source: ReviewCase["source"];
  error?: string;
  factCount: number;
  visibleItemCount: number;
  subheadingCount: number;
  duplicateCount: number;
  missingCount: number;
  leakedCount: number;
  auditIssueCounts: Record<string, number>;
};

const reviewCases: ReviewCase[] = [
  {
    label: "gavin",
    nameHint: "Gavin",
    source: "session",
    sessionId: "c06e972f-98da-44eb-b969-ef0950a76482"
  },
  {
    label: "tatiana",
    nameHint: "Tatiana",
    source: "session",
    sessionId: "a3fc883e-db0d-4c5a-9664-9e952d73a6cb"
  },
  {
    label: "jevon",
    nameHint: "Jevon",
    source: "session",
    sessionId: "719a65e6-9a20-4dfd-9995-8292878d41bd"
  },
  {
    label: "joe",
    nameHint: "Joe",
    source: "session",
    sessionId: "7317ced4-e03e-4d8a-ac77-a8d9909d6925"
  },
  {
    label: "ashley",
    nameHint: "Ashley",
    source: "session",
    sessionId: "323c14b0-58ce-4051-88d9-faa371e5b0f1"
  },
  {
    label: "joe-raw-doc",
    nameHint: "Joe",
    source: "raw-doc",
    rawDocPath:
      "/Users/will/Library/Containers/com.apple.mail/Data/Library/Mail Downloads/B8AC71BB-4CC3-488A-8019-0C66E425EC1B/Joe Raw Data from Mother in Word - she didn't fill online.docx"
  }
];

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeText(value: string) {
  return compactWhitespace(value)
    .replace(/^\s*[A-Za-z][A-Za-z0-9 &'’/,-]{1,60}:\s+/, "")
    .toLowerCase();
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

  const leftTokens = [...new Set(contentTokens(left))];
  const rightTokens = [...new Set(contentTokens(right))];
  if (leftTokens.length < 4 || rightTokens.length < 4) {
    return false;
  }

  const overlapCount = leftTokens.filter((token) => rightTokens.includes(token)).length;
  const unionCount = new Set([...leftTokens, ...rightTokens]).size;
  return unionCount > 0 && overlapCount / unionCount >= 0.78;
}

function docxText(filePath: string) {
  const xml = execFileSync("unzip", ["-p", filePath, "word/document.xml"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });

  return compactWhitespace(
    xml
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
  );
}

function isNoInfo(value: string) {
  return normalizeText(value).replace(/[.!?]+$/g, "") === "(no information provided)";
}

function visibleItems(summary: StructuredSummary) {
  return summary.sections.flatMap((section) =>
    section.items
      .map(compactWhitespace)
      .filter((item) => item && !isNoInfo(item))
      .map((item) => ({ section: section.title, item }))
  );
}

function duplicateCount(summary: StructuredSummary) {
  const seen: string[] = [];
  let duplicates = 0;

  for (const { item } of visibleItems(summary)) {
    if (seen.some((existing) => itemsAreNearDuplicate(item, existing))) {
      duplicates += 1;
      continue;
    }

    seen.push(item);
  }

  return duplicates;
}

function subheadingCount(summary: StructuredSummary) {
  return summary.sections.reduce(
    (count, section) =>
      count +
      (section.blocks ?? []).reduce(
        (blockCount, block) =>
          block.type === "labeledBullets" ? blockCount + block.groups.length : blockCount,
        0
      ),
    0
  );
}

function issueCounts(issues: SummaryAuditIssue[]) {
  return issues.reduce<Record<string, number>>((counts, issue) => {
    counts[issue.code] = (counts[issue.code] ?? 0) + 1;
    return counts;
  }, {});
}

function sectionLabels(summary: StructuredSummary, title: string) {
  return summary.sections
    .find((section) => section.title === title)
    ?.blocks?.flatMap((block) => block.type === "labeledBullets" ? block.groups.map((group) => group.label) : []) ?? [];
}

function hierarchyNotes(before: StructuredSummary, after: StructuredSummary) {
  const titles = new Set([...before.sections, ...after.sections].map((section) => section.title));
  return [...titles].flatMap((title) => {
    const beforeLabels = sectionLabels(before, title);
    const afterLabels = sectionLabels(after, title);
    if (beforeLabels.join(" | ") === afterLabels.join(" | ")) {
      return [];
    }

    return [
      `${title}: ${beforeLabels.length > 0 ? beforeLabels.join(" / ") : "(none)"} -> ${
        afterLabels.length > 0 ? afterLabels.join(" / ") : "(none)"
      }`
    ];
  });
}

async function loadFixtureCases(projectRoot: string): Promise<ReviewCase[]> {
  const fixturesDir = path.join(projectRoot, "benchmarks", "summary", "fixtures");
  const entries = await readdir(fixturesDir);
  return Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map(async (entry) => {
        const filePath = path.join(fixturesDir, entry);
        const fixture = JSON.parse(await readFile(filePath, "utf8")) as {
          id: string;
          nameHint?: string;
          turns: ConversationTurn[];
        };

        return {
          label: `fixture-${fixture.id}`,
          nameHint: fixture.nameHint ?? "",
          source: "fixture" as const,
          turns: fixture.turns
        };
      })
  );
}

async function loadCaseTurns(supabase: any | null, reviewCase: ReviewCase) {
  if (reviewCase.turns) {
    return reviewCase.turns;
  }

  if (reviewCase.rawDocPath) {
    if (!existsSync(reviewCase.rawDocPath)) {
      throw new Error(`Raw document not found: ${reviewCase.rawDocPath}`);
    }

    return [
      {
        id: `${reviewCase.label}-raw-doc`,
        role: "user",
        promptType: "section_prompt",
        content: docxText(reviewCase.rawDocPath),
        createdAt: "2026-06-20T00:00:00.000Z"
      }
    ] satisfies ConversationTurn[];
  }

  if (!supabase || !reviewCase.sessionId) {
    throw new Error("Supabase credentials are required for session review cases.");
  }

  const { data: session, error } = await supabase
    .from("sessions")
    .select("draft_json")
    .eq("id", reviewCase.sessionId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message ?? `Unable to load ${reviewCase.label}.`);
  }

  return ((session?.draft_json as { turns?: ConversationTurn[] } | null)?.turns ?? [])
    .filter((turn) => turn.role === "user" || turn.role === "assistant");
}

async function writeCaseArtifacts(
  outputDir: string,
  reviewCase: ReviewCase,
  result: Awaited<ReturnType<typeof generateCaregiverSummaryWithQa>>
) {
  const plainText = summaryToPlainText(result.summary);
  await Promise.all([
    writeFile(path.join(outputDir, `${reviewCase.label}.summary.json`), JSON.stringify(result.summary, null, 2)),
    writeFile(path.join(outputDir, `${reviewCase.label}.facts.json`), JSON.stringify(result.facts, null, 2)),
    writeFile(path.join(outputDir, `${reviewCase.label}.audit.json`), JSON.stringify(result.auditReport, null, 2)),
    writeFile(path.join(outputDir, `${reviewCase.label}.summary.txt`), plainText)
  ]);
}

function metricsForCase(
  reviewCase: ReviewCase,
  result: Awaited<ReturnType<typeof generateCaregiverSummaryWithQa>>
): CaseMetrics {
  const counts = issueCounts(result.auditReport.issues);
  return {
    label: reviewCase.label,
    source: reviewCase.source,
    factCount: result.facts.length,
    visibleItemCount: visibleItems(result.summary).length,
    subheadingCount: subheadingCount(result.summary),
    duplicateCount: duplicateCount(result.summary),
    missingCount: counts.missing_coverage ?? 0,
    leakedCount: counts.section_leakage ?? 0,
    auditIssueCounts: counts
  };
}

async function readSummaryIfPresent(dir: string, label: string) {
  const filePath = path.join(dir, `${label}.summary.json`);
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(await readFile(filePath, "utf8")) as StructuredSummary;
}

async function compareAgainstBaseline(
  baselineDir: string,
  outputDir: string,
  reviewCase: ReviewCase,
  afterSummary: StructuredSummary
) {
  const beforeSummary = await readSummaryIfPresent(baselineDir, reviewCase.label);
  if (!beforeSummary) {
    return null;
  }

  const beforeText = summaryToPlainText(beforeSummary);
  const afterText = summaryToPlainText(afterSummary);
  const sideBySide = [
    `# ${reviewCase.label}`,
    "",
    "## Before",
    beforeText,
    "",
    "## After",
    afterText,
    "",
    "## Hierarchy Notes",
    ...hierarchyNotes(beforeSummary, afterSummary).map((note) => `- ${note}`)
  ].join("\n");

  await writeFile(path.join(outputDir, `${reviewCase.label}.side-by-side.txt`), sideBySide);
  return {
    label: reviewCase.label,
    before: {
      visibleItemCount: visibleItems(beforeSummary).length,
      subheadingCount: subheadingCount(beforeSummary),
      duplicateCount: duplicateCount(beforeSummary)
    },
    after: {
      visibleItemCount: visibleItems(afterSummary).length,
      subheadingCount: subheadingCount(afterSummary),
      duplicateCount: duplicateCount(afterSummary)
    },
    hierarchyNotes: hierarchyNotes(beforeSummary, afterSummary)
  };
}

async function main() {
  const projectRoot = process.cwd();
  loadEnvConfig(projectRoot);

  const phase = process.env.SUMMARY_REVIEW_PHASE === "before" ? "before" : "after";
  const rootDir = process.env.SUMMARY_REVIEW_ROOT_DIR || "/tmp/caregiver-summary-hierarchy-review";
  const outputDir = path.join(rootDir, phase);
  const baselineDir = process.env.SUMMARY_BASELINE_DIR || path.join(rootDir, "before");
  await mkdir(outputDir, { recursive: true });

  const hasSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
  const supabase = hasSupabase
    ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
    : null;
  const cases = [...reviewCases, ...(await loadFixtureCases(projectRoot))];
  const reports: CaseMetrics[] = [];
  const comparisons = [];

  for (const reviewCase of cases) {
    try {
      const turns = await loadCaseTurns(supabase, reviewCase);
      const result = await generateCaregiverSummaryWithQa(turns, reviewCase.nameHint, "two-step");
      await writeCaseArtifacts(outputDir, reviewCase, result);
      reports.push(metricsForCase(reviewCase, result));

      if (phase === "after" && existsSync(baselineDir)) {
        const comparison = await compareAgainstBaseline(baselineDir, outputDir, reviewCase, result.summary);
        if (comparison) {
          comparisons.push(comparison);
        }
      }
    } catch (error) {
      reports.push({
        label: reviewCase.label,
        source: reviewCase.source,
        error: error instanceof Error ? error.message : String(error),
        factCount: 0,
        visibleItemCount: 0,
        subheadingCount: 0,
        duplicateCount: 0,
        missingCount: 0,
        leakedCount: 0,
        auditIssueCounts: {}
      });
    }
  }

  await writeFile(path.join(outputDir, "review-report.json"), JSON.stringify(reports, null, 2));
  await writeFile(path.join(outputDir, "before-after-report.json"), JSON.stringify(comparisons, null, 2));
  await writeFile(
    path.join(outputDir, "review-report.txt"),
    reports
      .map((report) =>
        [
          `${report.error ? "FAIL" : "DONE"} ${report.label}`,
          report.error ? `  error=${report.error}` : "",
          `  facts=${report.factCount} items=${report.visibleItemCount} subheadings=${report.subheadingCount}`,
          `  duplicates=${report.duplicateCount} missing=${report.missingCount} leaked=${report.leakedCount}`
        ].filter(Boolean).join("\n")
      )
      .join("\n\n")
  );

  console.log(`Wrote ${phase} review artifacts to ${outputDir}`);
  if (phase === "after") {
    console.log(`Compared against ${baselineDir} when matching baseline artifacts existed.`);
  }
}

void main();
