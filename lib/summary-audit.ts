import {
  PREFERRED_SUMMARY_SECTION_ORDER,
  inferAuthoritativeSectionTitle,
  normalizeAuthoritativeStructuredSummary,
  normalizeEditableStructuredSummary
} from "@/lib/summary";
import { StructuredSummary, SummaryAuditIssue, SummaryAuditReport } from "@/lib/types";

const NO_INFORMATION_PLACEHOLDER = "(No information provided)";

export type SummaryAuditSource = "generated" | "edited" | "saved";

type SummaryAuditOptions = {
  source: SummaryAuditSource;
  nameHint?: string;
  issues?: SummaryAuditIssue[];
  diagnostics?: string[];
};

function normalizeAuditText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function auditTokens(value: string) {
  return normalizeAuditText(value)
    .split(" ")
    .filter((token) => token.length > 2);
}

function itemsAreNearDuplicate(left: string, right: string) {
  const normalizedLeft = normalizeAuditText(left);
  const normalizedRight = normalizeAuditText(right);

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

  const leftTokens = auditTokens(left);
  const rightTokens = auditTokens(right);

  if (leftTokens.length < 3 || rightTokens.length < 3) {
    return false;
  }

  const overlapCount = leftTokens.filter((token) => rightTokens.includes(token)).length;
  const unionCount = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = unionCount === 0 ? 0 : overlapCount / unionCount;

  return jaccard >= 0.78;
}

function isMeaningfulItem(item: string) {
  return normalizeAuditText(item) !== normalizeAuditText(NO_INFORMATION_PLACEHOLDER);
}

function isAwkwardLowSignalItem(item: string, sectionTitle: string) {
  if (/^(?:also|and|but|too)\b/i.test(item)) {
    return true;
  }

  if (/^(?:he|she|they)\s+also\s+(?:likes?|loves?|enjoys?)\b/i.test(item)) {
    return true;
  }

  if (
    sectionTitle === "What helps the day go well" &&
    /\b(favorite person|spending time with family|downtime|watch tv|watch television|left alone to do (?:his|her|their) own thing)\b/i.test(
      item
    )
  ) {
    return true;
  }

  if (
    sectionTitle === "What helps the day go well" &&
    !/\b(help|supports?|routine|visual|timer|schedule|food|quiet|low-light|low light|prevent|structured|regulat)\b/i.test(
      item
    ) &&
    /^(?:mom|he|she|they|gavin)\b/i.test(item)
  ) {
    return true;
  }

  return false;
}

function dedupeIssues(issues: SummaryAuditIssue[]) {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = [
      issue.code,
      issue.message,
      issue.factId ?? "",
      issue.expectedSection ?? "",
      issue.actualSection ?? "",
      issue.sectionTitle ?? "",
      issue.item ?? ""
    ].join("::");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function summarizeSummaryAuditReport(report: SummaryAuditReport) {
  const issueMessages = [...new Set(report.issues.map((issue) => issue.message))].slice(0, 3);
  const sectionMessages = report.sectionWarnings
    .slice(0, 3)
    .map((warning) => `${warning.count} warning${warning.count === 1 ? "" : "s"} in ${warning.sectionTitle}.`);

  return [...issueMessages, ...sectionMessages].slice(0, 4);
}

export function finalizeSummaryWithQa(input: unknown, options: SummaryAuditOptions) {
  const summary =
    options.source === "generated"
      ? normalizeAuthoritativeStructuredSummary(input, options.nameHint)
      : normalizeEditableStructuredSummary(input, options.nameHint);
  const issues: SummaryAuditIssue[] = [...(options.issues ?? [])];

  for (const section of summary.sections) {
    const title = section.title as (typeof PREFERRED_SUMMARY_SECTION_ORDER)[number];
    const meaningfulItems = section.items.filter(isMeaningfulItem);

    for (const item of meaningfulItems) {
      const authoritativeTitle = inferAuthoritativeSectionTitle(item, title);
      if (authoritativeTitle !== title) {
        issues.push({
          code: "wrong_section",
          message: `A bullet in ${title} belongs in ${authoritativeTitle}: ${item}`,
          expectedSection: authoritativeTitle,
          actualSection: title,
          sectionTitle: title,
          item
        });
      }

      if (isAwkwardLowSignalItem(item, title)) {
        issues.push({
          code: "awkward_item",
          message: `${title} contains a low-signal or awkward bullet: ${item}`,
          sectionTitle: title,
          item
        });
      }
    }

    for (let index = 0; index < meaningfulItems.length; index += 1) {
      const item = meaningfulItems[index];
      for (let otherIndex = index + 1; otherIndex < meaningfulItems.length; otherIndex += 1) {
        const otherItem = meaningfulItems[otherIndex];
        if (itemsAreNearDuplicate(item, otherItem)) {
          issues.push({
            code: "duplicate_item",
            message: `${title} contains duplicate or overlapping bullets that should be collapsed.`,
            sectionTitle: title,
            item
          });
          break;
        }
      }
    }
  }

  const dedupedIssues = dedupeIssues(issues);
  const sectionWarningCounts = new Map<string, number>();

  for (const issue of dedupedIssues) {
    const sectionTitle = issue.actualSection ?? issue.sectionTitle ?? issue.expectedSection;
    if (!sectionTitle) {
      continue;
    }

    sectionWarningCounts.set(sectionTitle, (sectionWarningCounts.get(sectionTitle) ?? 0) + 1);
  }

  const sectionWarnings = [...sectionWarningCounts.entries()]
    .sort((left, right) => {
      const leftIndex = PREFERRED_SUMMARY_SECTION_ORDER.indexOf(left[0] as (typeof PREFERRED_SUMMARY_SECTION_ORDER)[number]);
      const rightIndex = PREFERRED_SUMMARY_SECTION_ORDER.indexOf(right[0] as (typeof PREFERRED_SUMMARY_SECTION_ORDER)[number]);

      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      return left[0].localeCompare(right[0]);
    })
    .map(([sectionTitle, count]) => ({ sectionTitle, count }));

  const report: SummaryAuditReport = {
    status: dedupedIssues.length > 0 ? "warn" : "pass",
    issues: dedupedIssues,
    diagnostics: options.diagnostics ?? [],
    sectionWarnings
  };

  return {
    summary,
    report
  };
}
