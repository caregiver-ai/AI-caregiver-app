import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { generateCaregiverSummaryWithQa } from "../lib/summary-generation";
import { PREFERRED_SUMMARY_SECTION_ORDER, summaryToPlainText } from "../lib/summary";
import type { ConversationTurn, StructuredSummary } from "../lib/types";

type CaseDefinition = {
  label: string;
  nameHint: string;
  sessionId?: string;
  rawDocPath?: string;
  expectedDocPath?: string;
};

type CaseReport = {
  label: string;
  nameHint: string;
  source: "session-draft" | "session-turns" | "raw-doc";
  error?: string;
  sourceTurnCount: number;
  expectedDocPresent: boolean;
  expectedDocWordCount: number;
  factCount: number;
  visibleItemCount: number;
  sectionCount: number;
  labeledBlockCount: number;
  duplicateCount: number;
  duplicatePairs: Array<{
    section: string;
    item: string;
    existingSection: string;
    existing: string;
  }>;
  auditIssueCounts: Record<string, number>;
  missingFactDiagnostics: string[];
  leakedFactDiagnostics: string[];
  groupingWarnings: string[];
  sentenceQualityWarnings: string[];
  supportGroupLabels: string[];
  pass: boolean;
};

const outputDir = "/tmp/caregiver-six-case-review-current";

const cases: CaseDefinition[] = [
  {
    label: "gavin",
    nameHint: "Gavin",
    sessionId: "c06e972f-98da-44eb-b969-ef0950a76482",
    expectedDocPath:
      "/Users/will/Library/Containers/com.apple.mail/Data/Library/Mail Downloads/F5E0B562-A0F0-4BF4-9A9B-AB427046AE2F/Gavin - ChatGPT Output.docx"
  },
  {
    label: "tatiana",
    nameHint: "Tatiana",
    sessionId: "a3fc883e-db0d-4c5a-9664-9e952d73a6cb",
    expectedDocPath:
      "/Users/will/Library/Containers/com.apple.mail/Data/Library/Mail Downloads/00571150-4B01-446A-B1AB-03A68A2227EC/Tatiana - ChatGPT Output.docx"
  },
  {
    label: "jevon",
    nameHint: "Jevon",
    sessionId: "719a65e6-9a20-4dfd-9995-8292878d41bd",
    expectedDocPath:
      "/Users/will/Library/Containers/com.apple.mail/Data/Library/Mail Downloads/4E64064C-1105-429E-B08A-FA55FDB59F9E/Jevon - ChatGPT Output.docx"
  },
  {
    label: "joe",
    nameHint: "Joe",
    sessionId: "7317ced4-e03e-4d8a-ac77-a8d9909d6925",
    expectedDocPath:
      "/Users/will/Library/Containers/com.apple.mail/Data/Library/Mail Downloads/71CF997C-D426-49C0-A173-81D6EEF29A76/Joe - ChatGPT Output.docx"
  },
  {
    label: "ashley",
    nameHint: "Ashley",
    sessionId: "323c14b0-58ce-4051-88d9-faa371e5b0f1",
    expectedDocPath:
      "/Users/will/Library/Containers/com.apple.mail/Data/Library/Mail Downloads/9F6DB7D7-06A0-4F0D1AC1E53/Ashley - ChatGPT Output.docx"
  },
  {
    label: "joe-raw-doc",
    nameHint: "Joe",
    rawDocPath:
      "/Users/will/Library/Containers/com.apple.mail/Data/Library/Mail Downloads/B8AC71BB-4CC3-488A-8019-0C66E425EC1B/Joe Raw Data from Mother in Word - she didn't fill online.docx",
    expectedDocPath:
      "/Users/will/Library/Containers/com.apple.mail/Data/Library/Mail Downloads/71CF997C-D426-49C0-A173-81D6EEF29A76/Joe - ChatGPT Output.docx"
  }
];

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeText(value: string) {
  return compactWhitespace(value).toLowerCase();
}

function duplicateCompareText(value: string) {
  return normalizeText(value)
    .replace(/^(?:how they communicate|what specific things mean|what helps communication|how they learn|visual and concrete supports|day-specific routines|hygiene and dressing details|toileting and bathroom support|morning and daily routines|food and drink notes|technology and music|movement and physical activities|sensory activities|outings and exploration|interests and toys|social preferences and downtime|other activities and preferences|additional activity notes|sensory and environmental triggers|routine, transition, and control triggers|body-state triggers|body signs|behavior signs|communication signs|environmental supports|calming supports|transitions and motivation|safety in the moment|additional support notes|emergency contacts|diagnoses and conditions|medications and allergies|equipment and supports|supervision and safety|quick tips):\s*/i, "")
    .replace(/^\s*[a-z][a-z0-9 &'’/,-]{1,60}:\s+/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
}

function contentTokens(value: string) {
  return duplicateCompareText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(" ")
    .filter((token) => token.length > 2);
}

function itemsAreNearDuplicate(left: string, right: string) {
  const normalizedLeft = duplicateCompareText(left);
  const normalizedRight = duplicateCompareText(right);

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
  return unionCount > 0 && overlapCount / unionCount >= 0.75;
}

function docxText(filePath: string) {
  try {
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
  } catch {
    return "";
  }
}

function noInfo(value: string) {
  return normalizeText(value).replace(/[.!?]+$/g, "") === "(no information provided)";
}

function allVisibleItems(summary: StructuredSummary) {
  return summary.sections.flatMap((section) =>
    section.items
      .filter((item) => compactWhitespace(item) && !noInfo(item))
      .map((item) => ({ section: section.title, item }))
  );
}

function duplicatePairs(summary: StructuredSummary) {
  const seen: Array<{ section: string; item: string }> = [];
  const duplicates: CaseReport["duplicatePairs"] = [];

  for (const entry of allVisibleItems(summary)) {
    const existing = seen.find((candidate) => itemsAreNearDuplicate(entry.item, candidate.item));
    if (existing) {
      duplicates.push({
        section: entry.section,
        item: entry.item,
        existingSection: existing.section,
        existing: existing.item
      });
      continue;
    }

    seen.push(entry);
  }

  return duplicates;
}

function countBlocks(summary: StructuredSummary, type: "labeledBullets" | "note" | "bullets" | "keyValue") {
  return summary.sections.reduce(
    (count, section) =>
      count + (section.blocks ?? []).filter((block) => block.type === type).length,
    0
  );
}

function sectionText(summary: StructuredSummary, title: string) {
  return summary.sections.find((section) => section.title === title)?.items.join("\n") ?? "";
}

function groupingWarnings(summary: StructuredSummary) {
  const warnings: string[] = [];
  const fullText = summaryToPlainText(summary);
  const supports = sectionText(summary, "What Helps When They Are Having a Hard Time");
  const daily = sectionText(summary, "Daily Routine");
  const food = sectionText(summary, "Food and Meals");
  const signs = sectionText(summary, "Signs They Need Help");
  const activities = sectionText(summary, "Activities and Interests");
  const communication = sectionText(summary, "Communication");

  if (/include include|car rides,\s*car rides/i.test(fullText)) {
    warnings.push("Contains repeated list wording such as 'include include' or duplicated car rides.");
  }

  if (/^Preferred activities include/im.test(supports)) {
    warnings.push("Support section contains a giant preferred-activities list.");
  }

  if ((daily.match(/\bHe is assisted with\b|\bShe is assisted with\b|\bThey are assisted with\b/gi) ?? []).length >= 3) {
    warnings.push("Daily Routine still has repeated atomic hygiene assistance bullets.");
  }

  if ((food.match(/^(?:Food and drink notes: )?(?:He|She|They|[A-Z][a-z]+) eats\b/gim) ?? []).length >= 3) {
    warnings.push("Food and Meals still has repeated atomic food bullets.");
  }

  const separateIllnessChecks =
    /not eating,? check for illness or pain/i.test(signs) &&
    /not drinking,? check for illness or pain/i.test(signs);
  if (separateIllnessChecks) {
    warnings.push("Signs section still has separate not-eating and not-drinking illness bullets.");
  }

  if (/IKEA|Bass Pro/i.test(communication)) {
    warnings.push("Activity/place preferences leaked into Communication.");
  }

  if (/things to pick|choices are shown|first-this-then|communicating non-verbally/i.test(activities)) {
    warnings.push("Learning or communication support leaked into Activities.");
  }

  if (!PREFERRED_SUMMARY_SECTION_ORDER.every((title) => summary.sections.some((section) => section.title === title))) {
    warnings.push("Guide is missing one or more expected guide sections.");
  }

  return warnings;
}

function supportGroupLabels(summary: StructuredSummary) {
  return summary.sections
    .find((section) => section.title === "What Helps When They Are Having a Hard Time")
    ?.blocks?.flatMap((block) => block.type === "labeledBullets" ? block.groups.map((group) => group.label) : []) ?? [];
}

function sentenceQualityWarnings(issues: Array<{ code: string; message: string }>) {
  return issues
    .filter((issue) => issue.code === "awkward_item" || issue.code === "incomplete_sentence")
    .map((issue) => issue.message);
}

function auditIssueCounts(issues: Array<{ code: string }>) {
  return issues.reduce<Record<string, number>>((counts, issue) => {
    counts[issue.code] = (counts[issue.code] ?? 0) + 1;
    return counts;
  }, {});
}

async function sessionTurns(supabase: any, sessionId: string) {
  const [{ data: session, error: sessionError }, { data: turns, error: turnError }] = await Promise.all([
    supabase
      .from("sessions")
      .select("draft_json")
      .eq("id", sessionId)
      .single(),
    supabase
      .from("conversation_turns")
      .select("id, role, prompt_type, content, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
  ]);

  if (sessionError) {
    throw sessionError;
  }

  if (turnError) {
    throw turnError;
  }

  const draftTurns = (session as { draft_json?: { turns?: unknown } }).draft_json?.turns;
  if (Array.isArray(draftTurns) && draftTurns.length > 0) {
    return {
      source: "session-draft" as const,
      turns: draftTurns as ConversationTurn[]
    };
  }

  return {
    source: "session-turns" as const,
    turns: (turns ?? []) as ConversationTurn[]
  };
}

async function caseTurns(supabase: any, definition: CaseDefinition) {
  if (definition.rawDocPath) {
    const content = docxText(definition.rawDocPath);
    if (!content) {
      throw new Error(`Unable to read raw doc for ${definition.label}: ${definition.rawDocPath}`);
    }

    return {
      source: "raw-doc" as const,
      turns: [
        {
          id: `${definition.label}-raw-doc`,
          role: "user",
          promptType: "section_prompt",
          content,
          createdAt: "2026-06-20T00:00:00.000Z"
        }
      ] satisfies ConversationTurn[]
    };
  }

  if (!definition.sessionId) {
    throw new Error(`Missing session id for ${definition.label}.`);
  }

  return sessionTurns(supabase, definition.sessionId);
}

async function main() {
  loadEnvConfig(process.cwd());
  process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
  process.env.OPENAI_SUMMARY_TIMEOUT_MS = process.env.OPENAI_SUMMARY_TIMEOUT_MS || "300000";

  await mkdir(outputDir, { recursive: true });

  const missingEnv = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY"].filter(
    (key) => !process.env[key]
  );
  if (missingEnv.length > 0) {
    throw new Error(`summary:review-cases requires ${missingEnv.join(" and ")}.`);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
  const reports: CaseReport[] = [];

  for (const definition of cases) {
    console.log(`\nCase: ${definition.label}`);
    try {
      const { source, turns } = await caseTurns(supabase, definition);
      const expectedText = definition.expectedDocPath ? docxText(definition.expectedDocPath) : "";
      const result = await generateCaregiverSummaryWithQa(turns, definition.nameHint, "two-step");
      const plainText = summaryToPlainText(result.summary);
      const duplicates = duplicatePairs(result.summary);
      const missingFactDiagnostics = result.auditReport.issues
        .filter((issue) => issue.code === "missing_coverage")
        .map((issue) => issue.message);
      const leakedFactDiagnostics = result.auditReport.issues
        .filter((issue) => issue.code === "section_leakage")
        .map((issue) => issue.message);
      const warnings = groupingWarnings(result.summary);
      const issueCounts = auditIssueCounts(result.auditReport.issues);
      const sentenceWarnings = sentenceQualityWarnings(result.auditReport.issues);
      const supportLabels = supportGroupLabels(result.summary);
      const report: CaseReport = {
        label: definition.label,
        nameHint: definition.nameHint,
        source,
        sourceTurnCount: turns.length,
        expectedDocPresent: Boolean(expectedText),
        expectedDocWordCount: expectedText ? expectedText.split(/\s+/).filter(Boolean).length : 0,
        factCount: result.facts.length,
        visibleItemCount: allVisibleItems(result.summary).length,
        sectionCount: result.summary.sections.length,
        labeledBlockCount: countBlocks(result.summary, "labeledBullets"),
        duplicateCount: duplicates.length,
        duplicatePairs: duplicates,
        auditIssueCounts: issueCounts,
        missingFactDiagnostics,
        leakedFactDiagnostics,
        groupingWarnings: warnings,
        sentenceQualityWarnings: sentenceWarnings,
        supportGroupLabels: supportLabels,
        pass:
          result.facts.length > 0 &&
          duplicates.length === 0 &&
          missingFactDiagnostics.length === 0 &&
          leakedFactDiagnostics.length === 0 &&
          (issueCounts.missing_coverage ?? 0) === 0 &&
          (issueCounts.section_leakage ?? 0) === 0 &&
          (issueCounts.wrong_section ?? 0) === 0 &&
          (issueCounts.awkward_item ?? 0) === 0 &&
          (issueCounts.incomplete_sentence ?? 0) === 0 &&
          warnings.length === 0
      };

      reports.push(report);

      await Promise.all([
        writeFile(path.join(outputDir, `${definition.label}.summary.json`), JSON.stringify(result.summary, null, 2)),
        writeFile(path.join(outputDir, `${definition.label}.facts.json`), JSON.stringify(result.facts, null, 2)),
        writeFile(path.join(outputDir, `${definition.label}.audit.json`), JSON.stringify(result.auditReport, null, 2)),
        writeFile(path.join(outputDir, `${definition.label}.summary.txt`), plainText),
        writeFile(path.join(outputDir, `${definition.label}.expected-doc.txt`), expectedText)
      ]);

      console.log(
        JSON.stringify(
          {
            pass: report.pass,
            source: report.source,
            sourceTurnCount: report.sourceTurnCount,
            facts: report.factCount,
            items: report.visibleItemCount,
            duplicates: report.duplicateCount,
            missing: report.missingFactDiagnostics.length,
            leaked: report.leakedFactDiagnostics.length,
            groupingWarnings: report.groupingWarnings.length,
            sentenceQualityWarnings: report.sentenceQualityWarnings.length,
            supportGroupLabels: report.supportGroupLabels,
            auditIssueCounts: report.auditIssueCounts,
            expectedDocPresent: report.expectedDocPresent
          },
          null,
          2
        )
      );
    } catch (error) {
      const report: CaseReport = {
        label: definition.label,
        nameHint: definition.nameHint,
        source: definition.rawDocPath ? "raw-doc" : "session-draft",
        error: error instanceof Error ? error.message : String(error),
        sourceTurnCount: 0,
        expectedDocPresent: false,
        expectedDocWordCount: 0,
        factCount: 0,
        visibleItemCount: 0,
        sectionCount: 0,
        labeledBlockCount: 0,
        duplicateCount: 0,
        duplicatePairs: [],
        auditIssueCounts: {},
        missingFactDiagnostics: [],
        leakedFactDiagnostics: [],
        groupingWarnings: [],
        sentenceQualityWarnings: [],
        supportGroupLabels: [],
        pass: false
      };
      reports.push(report);
      console.log(JSON.stringify({ pass: false, error: report.error }, null, 2));
    }
  }

  const failed = reports.filter((report) => !report.pass);
  const reportText = [
    `Output directory: ${outputDir}`,
    "",
    ...reports.map((report) =>
      [
        `${report.pass ? "PASS" : "FAIL"} ${report.label}`,
        report.error ? `  error=${report.error}` : "",
        `  source=${report.source} turns=${report.sourceTurnCount} facts=${report.factCount} items=${report.visibleItemCount}`,
        `  duplicates=${report.duplicateCount} missing=${report.missingFactDiagnostics.length} leaked=${report.leakedFactDiagnostics.length} groupingWarnings=${report.groupingWarnings.length} sentenceWarnings=${report.sentenceQualityWarnings.length}`,
        report.supportGroupLabels.length > 0
          ? `  supportGroupLabels=${report.supportGroupLabels.join(" | ")}`
          : "",
        `  expectedDocPresent=${report.expectedDocPresent} expectedDocWords=${report.expectedDocWordCount}`,
        report.duplicatePairs.length > 0
          ? `  duplicatePairs=${JSON.stringify(report.duplicatePairs.slice(0, 5))}`
          : "",
        report.groupingWarnings.length > 0
          ? `  groupingWarnings=${report.groupingWarnings.join(" | ")}`
          : "",
        report.sentenceQualityWarnings.length > 0
          ? `  sentenceWarnings=${report.sentenceQualityWarnings.slice(0, 3).join(" | ")}`
          : "",
        report.missingFactDiagnostics.length > 0
          ? `  missingExamples=${report.missingFactDiagnostics.slice(0, 3).join(" | ")}`
          : "",
        report.leakedFactDiagnostics.length > 0
          ? `  leakedExamples=${report.leakedFactDiagnostics.slice(0, 3).join(" | ")}`
          : ""
      ].filter(Boolean).join("\n")
    )
  ].join("\n");

  await writeFile(path.join(outputDir, "review-report.json"), JSON.stringify(reports, null, 2));
  await writeFile(path.join(outputDir, "review-report.txt"), reportText);
  console.log(`\n${reportText}`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
