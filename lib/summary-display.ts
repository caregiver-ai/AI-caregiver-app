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
    return block.items.length > 0;
  }

  if (block.type === "labeledBullets") {
    return block.groups.some((group) => group.items.length > 0);
  }

  if (block.type === "keyValue") {
    return block.rows.length > 0;
  }

  return Boolean(compactWhitespace(block.text));
}

export function sectionHasContent(section: SummarySection) {
  return Boolean(
    section.title.trim() &&
      (compactWhitespace(section.intro ?? "") || getSectionBlocks(section).some(blockHasContent))
  );
}

export function getVisibleSections(summary: StructuredSummary) {
  return summary.sections.filter(sectionHasContent);
}

export function summaryHasContent(summary: StructuredSummary) {
  return Boolean(compactWhitespace(summary.overview)) || getVisibleSections(summary).length > 0;
}

export function blockToPlainTextLines(block: SummaryBlock): string[] {
  if (block.type === "bullets") {
    return uniqueStrings(block.items.map(compactWhitespace).filter(Boolean));
  }

  if (block.type === "keyValue") {
    return uniqueStrings(
      block.rows
        .map((row) => `${compactWhitespace(row.label)}: ${compactWhitespace(row.value)}`)
        .filter((line) => line !== ":")
    );
  }

  if (block.type === "labeledBullets") {
    return uniqueStrings(
      block.groups.flatMap((group) => {
        const label = compactWhitespace(group.label);
        return group.items
          .map((item) => {
            const text = compactWhitespace(item);
            return label && text ? `${label}: ${text}` : text;
          })
          .filter(Boolean);
      })
    );
  }

  return compactWhitespace(block.text) ? [compactWhitespace(block.text)] : [];
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
    ...getVisibleSections(summary).flatMap((section) => [section.title, ...sectionToPlainTextLines(section)])
  ]
    .filter(Boolean)
    .join("\n");
}
