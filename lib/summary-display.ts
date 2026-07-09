import { StructuredSummary, SummaryBlock, SummarySection } from "@/lib/types";

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = compactWhitespace(value).toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function isNoInformation(value: string) {
  return compactWhitespace(value).toLowerCase() === "(no information provided)";
}

function sectionIsAbout(section: SummarySection) {
  return /^about(?:\s+.+)?$/i.test(compactWhitespace(section.title));
}

export function extractSummaryDisplayName(summary: Pick<StructuredSummary, "title">) {
  const match = summary.title.trim().match(/^Caring for\s+(.+)$/i);
  return compactWhitespace(match?.[1] ?? "");
}

export function getSummarySectionDisplayTitle(
  summary: Pick<StructuredSummary, "title">,
  section: SummarySection
) {
  if (!sectionIsAbout(section)) {
    return section.title;
  }

  const name = extractSummaryDisplayName(summary);
  return name ? `About ${name}` : "About";
}

export function getSectionBlocks(section: SummarySection): SummaryBlock[] {
  if (Array.isArray(section.blocks) && section.blocks.length > 0) {
    return section.blocks;
  }

  if (section.items.length > 0) {
    return [
      {
        type: "bullets",
        items: section.items
      }
    ];
  }

  return [];
}

export function blockHasContent(block: SummaryBlock) {
  if (block.type === "bullets") {
    return block.items.some((item) => !isNoInformation(item));
  }

  if (block.type === "labeledBullets") {
    return block.groups.some(
      (group) =>
        (compactWhitespace(group.intro ?? "") && !isNoInformation(group.intro ?? "")) ||
        group.items.some((item) => !isNoInformation(item))
    );
  }

  if (block.type === "keyValue") {
    return block.rows.length > 0;
  }

  return Boolean(compactWhitespace(block.text)) && !isNoInformation(block.text);
}

export function sectionHasContent(section: SummarySection) {
  const meaningfulItems = section.items.some((item) => !isNoInformation(item));
  return Boolean(
    section.title.trim() &&
      (
        compactWhitespace(section.intro ?? "") ||
        getSectionBlocks(section).some(blockHasContent) ||
        meaningfulItems
      )
  );
}

export function getVisibleSections(summary: StructuredSummary) {
  return summary.sections.filter(sectionHasContent);
}

export function getVisibleAboutSection(summary: StructuredSummary) {
  return getVisibleSections(summary).find(sectionIsAbout) ?? null;
}

export function getVisibleDetailSections(summary: StructuredSummary) {
  return getVisibleSections(summary).filter((section) => !sectionIsAbout(section));
}

export function summaryHasContent(summary: StructuredSummary) {
  return (
    Boolean(compactWhitespace(summary.overview)) ||
    (summary.caregiverInsights ?? []).some((insight) => compactWhitespace(insight.statement)) ||
    getVisibleSections(summary).length > 0
  );
}

export function blockToPlainTextLines(block: SummaryBlock): string[] {
  if (block.type === "bullets") {
    return uniqueStrings(block.items.map(compactWhitespace).filter((item) => item && !isNoInformation(item)));
  }

  if (block.type === "keyValue") {
    return uniqueStrings(
      block.rows
        .map((row) => `${compactWhitespace(row.label)}: ${compactWhitespace(row.value)}`)
        .filter((line) => line !== ":" && !isNoInformation(line))
    );
  }

  if (block.type === "labeledBullets") {
    return uniqueStrings(
      block.groups.flatMap((group) => {
        const label = compactWhitespace(group.label);
        return [
          group.intro && label ? `${label}: ${compactWhitespace(group.intro)}` : compactWhitespace(group.intro ?? ""),
          ...group.items.map((item) => {
            const text = compactWhitespace(item);
            return label && text ? `${label}: ${text}` : text;
          })
        ]
          .map(compactWhitespace)
          .filter((line) => line && !isNoInformation(line));
      })
    );
  }

  return compactWhitespace(block.text) && !isNoInformation(block.text)
    ? [compactWhitespace(block.text)]
    : [];
}

export function sectionToPlainTextLines(section: SummarySection) {
  return uniqueStrings([
    compactWhitespace(section.intro ?? ""),
    ...getSectionBlocks(section).flatMap(blockToPlainTextLines)
  ]).filter(Boolean);
}

export function sectionToSearchText(section: SummarySection) {
  return sectionToPlainTextLines(section).join("\n");
}

export function summaryToSearchText(summary: StructuredSummary) {
  return [
    compactWhitespace(summary.title),
    compactWhitespace(summary.overview),
    ...(summary.caregiverInsights ?? []).map((insight) => compactWhitespace(insight.statement)),
    ...getVisibleSections(summary).flatMap((section) => [
      getSummarySectionDisplayTitle(summary, section),
      ...sectionToPlainTextLines(section)
    ])
  ]
    .filter(Boolean)
    .join("\n");
}
