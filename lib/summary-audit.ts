import {
  PREFERRED_SUMMARY_SECTION_ORDER,
  inferAuthoritativeSectionTitle,
  normalizeAuthoritativeStructuredSummary,
  normalizeEditableStructuredSummary
} from "@/lib/summary";
import {
  StructuredSummary,
  SummaryAuditIssue,
  SummaryAuditReport,
  SummaryAuditSectionWarning,
  SummaryAuditSeverity,
  SummaryAuditVisibility
} from "@/lib/types";

const NO_INFORMATION_PLACEHOLDER = "(No information provided)";
const HEALTH_AND_SAFETY_TITLE = "Health & Safety";
const WHO_TO_CONTACT_TITLE = "Who to contact (and when)";

export type SummaryAuditSource = "generated" | "edited" | "saved";

type SummaryAuditOptions = {
  source: SummaryAuditSource;
  nameHint?: string;
  issues?: SummaryAuditIssue[];
  diagnostics?: string[];
};

type SummaryAuditIssueClassification = {
  severity: SummaryAuditSeverity;
  visibility: SummaryAuditVisibility;
  userMessage?: string;
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

function usesSupportLanguage(item: string) {
  return /\b(help|helps|support|supports|routine|visual|timer|schedule|food|quiet|low-light|low light|prevent|structured|regulat|calm|sooth|settle|engag)\b/i.test(
    item
  );
}

function isShortRegulationSupport(item: string, sectionTitle: string) {
  return (
    sectionTitle === "What helps the day go well" &&
    /\b(walks?|car rides?|car ride)\b/i.test(item) &&
    /^(?:he|she|they|gavin)\s+(?:enjoys?|likes?)\b/i.test(item) &&
    !(item.match(/,/g) ?? []).length
  );
}

function isLongPreferenceInventory(item: string, sectionTitle: string) {
  if (
    sectionTitle !== "What helps the day go well" ||
    !/^(?:mom|he|she|they|gavin)\b/i.test(item)
  ) {
    return false;
  }

  const commaCount = (item.match(/,/g) ?? []).length;
  const andCount = (item.match(/\band\b/gi) ?? []).length;

  return commaCount >= 3 || (commaCount >= 1 && andCount >= 2) || item.length >= 140;
}

function isAwkwardLowSignalItem(item: string, sectionTitle: string) {
  if (/^(?:also|and|but)\b/i.test(item)) {
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
    /\b(hit herself|hitting herself|swear(?:ing)?|angry or frustrated days?)\b/i.test(item)
  ) {
    return true;
  }

  if (
    sectionTitle === "What can upset or overwhelm them" &&
    /\b(crowded teeth|rotor rooted|rooted)\b/i.test(item)
  ) {
    return true;
  }

  if (
    sectionTitle === "Signs they need help" &&
    (/^Sometimes (?:she )?(?:asks for help|can respond)(?: when [^.]+)?\.?$/i.test(item) ||
      /\bthere is something that has dysregulated her\b/i.test(item) ||
      /\bgoing on for \d+|\b\d+\s*(?:or|-)\s*\d+\s+years|swallow studies?|brain review|GI review|nobody can find anything wrong|cycle\b/i.test(
        item
      ))
  ) {
    return true;
  }

  if (
    sectionTitle === "What helps when they are having a hard time" &&
    (/\bdo not hesitate to call\b/i.test(item) ||
      /\b(morning\b.*\bmedicine|vaginal area|blood pressure drops|starts falling|runs constipated|do not rush her)\b/i.test(
        item
      ))
  ) {
    return true;
  }

  if (isShortRegulationSupport(item, sectionTitle)) {
    return false;
  }

  if (
    sectionTitle === "What helps the day go well" &&
    !usesSupportLanguage(item) &&
    isLongPreferenceInventory(item, sectionTitle)
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
      issue.severity ?? "",
      issue.visibility ?? "",
      issue.userMessage ?? "",
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

function isHighStakesSection(sectionTitle?: string) {
  return sectionTitle === HEALTH_AND_SAFETY_TITLE || sectionTitle === WHO_TO_CONTACT_TITLE;
}

function buildDefaultUserMessage(issue: SummaryAuditIssue) {
  const relevantSection =
    issue.expectedSection && isHighStakesSection(issue.expectedSection)
      ? issue.expectedSection
      : issue.actualSection && isHighStakesSection(issue.actualSection)
        ? issue.actualSection
        : issue.sectionTitle && isHighStakesSection(issue.sectionTitle)
          ? issue.sectionTitle
          : issue.expectedSection || issue.actualSection || issue.sectionTitle;

  if (relevantSection === WHO_TO_CONTACT_TITLE) {
    return issue.code === "missing_coverage"
      ? "A contact detail may be missing from the summary."
      : "A contact detail may be in the wrong section and should be reviewed.";
  }

  if (relevantSection === HEALTH_AND_SAFETY_TITLE) {
    return issue.code === "missing_coverage"
      ? "A health or safety detail may be missing from the summary."
      : "A health or safety detail may be in the wrong section and should be reviewed.";
  }

  return "An important detail may need review before sharing.";
}

function classifyIssue(issue: SummaryAuditIssue): SummaryAuditIssueClassification {
  if (issue.severity && issue.visibility) {
    return {
      severity: issue.severity,
      visibility: issue.visibility,
      userMessage:
        issue.userMessage ??
        (issue.visibility === "user" ? buildDefaultUserMessage(issue) : undefined)
    };
  }

  if (issue.code === "awkward_item" || issue.code === "duplicate_item") {
    return {
      severity: "soft",
      visibility: "internal"
    };
  }

  if (
    isHighStakesSection(issue.expectedSection) ||
    isHighStakesSection(issue.actualSection) ||
    isHighStakesSection(issue.sectionTitle)
  ) {
    return {
      severity: "hard",
      visibility: "user",
      userMessage: issue.userMessage ?? buildDefaultUserMessage(issue)
    };
  }

  return {
    severity: "soft",
    visibility: "internal"
  };
}

function normalizeIssue(issue: SummaryAuditIssue): SummaryAuditIssue {
  const classification = classifyIssue(issue);

  return {
    ...issue,
    severity: classification.severity,
    visibility: classification.visibility,
    userMessage: classification.userMessage
  };
}

function buildSectionWarnings(
  issues: SummaryAuditIssue[],
  visibility?: SummaryAuditVisibility
): SummaryAuditSectionWarning[] {
  const sectionWarningCounts = new Map<string, number>();

  for (const issue of issues) {
    if (visibility && issue.visibility !== visibility) {
      continue;
    }

    const sectionTitle = issue.actualSection ?? issue.sectionTitle ?? issue.expectedSection;
    if (!sectionTitle) {
      continue;
    }

    sectionWarningCounts.set(sectionTitle, (sectionWarningCounts.get(sectionTitle) ?? 0) + 1);
  }

  return [...sectionWarningCounts.entries()]
    .sort((left, right) => {
      const leftIndex = PREFERRED_SUMMARY_SECTION_ORDER.indexOf(left[0] as (typeof PREFERRED_SUMMARY_SECTION_ORDER)[number]);
      const rightIndex = PREFERRED_SUMMARY_SECTION_ORDER.indexOf(right[0] as (typeof PREFERRED_SUMMARY_SECTION_ORDER)[number]);

      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      return left[0].localeCompare(right[0]);
    })
    .map(([sectionTitle, count]) => ({ sectionTitle, count }));
}

export function normalizeSummaryAuditReport(report: SummaryAuditReport): SummaryAuditReport {
  const normalizedIssues = dedupeIssues((report.issues ?? []).map(normalizeIssue));
  const userVisibleIssues = normalizedIssues.filter((issue) => issue.visibility === "user");

  return {
    status: normalizedIssues.length > 0 ? "warn" : "pass",
    userStatus: userVisibleIssues.length > 0 ? "warn" : "pass",
    issues: normalizedIssues,
    userVisibleIssues,
    diagnostics: report.diagnostics ?? [],
    sectionWarnings: buildSectionWarnings(normalizedIssues),
    userSectionWarnings: buildSectionWarnings(userVisibleIssues, "user")
  };
}

export function collectRepairHintsFromAuditReport(
  report: SummaryAuditReport,
  scope: "all" | "soft" | "hard" = "all"
) {
  const normalized = normalizeSummaryAuditReport(report);
  const issues = normalized.issues.filter((issue) => {
    if (scope === "hard") {
      return issue.severity === "hard";
    }

    if (scope === "soft") {
      return (
        issue.severity === "soft" &&
        (issue.code === "awkward_item" || issue.code === "duplicate_item")
      );
    }

    return (
      issue.severity === "hard" ||
      (issue.severity === "soft" &&
        (issue.code === "awkward_item" || issue.code === "duplicate_item"))
    );
  });

  return [...new Set(issues.map((issue) => issue.message.trim()).filter(Boolean))].slice(0, 8);
}

export function summarizeSummaryAuditReport(report: SummaryAuditReport) {
  const normalized = normalizeSummaryAuditReport(report);
  const issueMessages = [...new Set(
    normalized.userVisibleIssues.map((issue) => issue.userMessage ?? issue.message)
  )].slice(0, 3);
  const sectionMessages = normalized.userSectionWarnings
    .slice(0, 3)
    .map((warning) => `${warning.count} warning${warning.count === 1 ? "" : "s"} in ${warning.sectionTitle}.`);

  return [...issueMessages, ...sectionMessages].slice(0, 4);
}

export function finalizeSummaryWithQa(input: unknown, options: SummaryAuditOptions) {
  const summary =
    options.source === "generated" || options.source === "saved"
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
          item,
          ...(classifyIssue({
            code: "wrong_section",
            message: "",
            expectedSection: authoritativeTitle,
            actualSection: title,
            sectionTitle: title,
            item
          }))
        });
      }

      if (isAwkwardLowSignalItem(item, title)) {
        issues.push({
          code: "awkward_item",
          message: `${title} contains a low-signal or awkward bullet: ${item}`,
          sectionTitle: title,
          item,
          severity: "soft",
          visibility: "internal"
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
            item,
            severity: "soft",
            visibility: "internal"
          });
          break;
        }
      }
    }
  }

  const report = normalizeSummaryAuditReport({
    status: "pass",
    userStatus: "pass",
    issues,
    userVisibleIssues: [],
    diagnostics: options.diagnostics ?? [],
    sectionWarnings: [],
    userSectionWarnings: []
  });

  return {
    summary,
    report
  };
}
