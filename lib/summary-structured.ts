import { EMPTY_SUMMARY } from "@/lib/constants";
import {
  ConversationTurn,
  StructuredSummary,
  SummaryBlock,
  SummaryFreshness,
  SummaryKeyValueRow,
  SummaryLabeledGroup,
  SummarySection
} from "@/lib/types";

export const SUMMARY_PIPELINE_VERSION = "2026-04-22-structured-v2";
export const SUMMARY_LAYOUT_VERSION = "2026-04-22-structured-v2";

type LegacyItemRecord = {
  id: string;
  text: string;
  used: boolean;
};

type LegacySummaryShape = Pick<StructuredSummary, "title" | "overview" | "generatedAt" | "sections">;

const LEGACY_SECTION_TITLES = [
  "Communication",
  "Daily Needs & Routines",
  "What helps the day go well",
  "What can upset or overwhelm them",
  "Signs they need help",
  "What helps when they are having a hard time",
  "Health & Safety",
  "Who to contact (and when)"
] as const;

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSourceText(value: string) {
  return value.replace(/\r/g, "\n").trim();
}

function splitSourceFragments(value: string) {
  return normalizeSourceText(value)
    .split(/\n{2,}|\n/)
    .flatMap((part) =>
      part
        .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])|\s*;\s*/)
        .map((fragment) => compactWhitespace(fragment))
        .filter(Boolean)
    );
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function dedupeCommunicationSoundItems(items: string[]) {
  const normalized = uniqueStrings(items);
  const hasHappySounds = normalized.some((item) => /^happy sounds, singing$/i.test(item));
  const hasLoudAngry = normalized.some((item) => /^loud\/angry sounds when upset$/i.test(item));

  return normalized.filter((item) => {
    if (hasHappySounds && /^happy sounds or singing$/i.test(item)) {
      return false;
    }

    if (hasLoudAngry && /^loud or angry sounds when upset$/i.test(item)) {
      return false;
    }

    return true;
  });
}

function dedupeCommunicationUseItems(items: string[]) {
  const normalized = uniqueStrings(items);
  const hasRequestItems = normalized.some((item) => /^request items \(e\.g\., "ipad" or "car"\)$/i.test(item));

  return normalized.filter((item) => {
    if (hasRequestItems && /^request items \(for example, "ipad" or "car"\)$/i.test(item)) {
      return false;
    }

    return true;
  });
}

function dedupeCommunicationWillItems(items: string[]) {
  const normalized = uniqueStrings(items);
  const hasLead = normalized.some((item) => /^lead you to what (?:he|she|they) needs$/i.test(item));
  const hasSitClose = normalized.some(
    (item) => /^sit close when (?:he|she|they) wants attention$/i.test(item)
  );

  return normalized.filter((item) => {
    if (
      hasLead &&
      hasSitClose &&
      /^lead you to what (?:he|she|they) needs or sit close when (?:he|she|they) wants attention$/i.test(
        item
      )
    ) {
      return false;
    }

    return true;
  });
}

function dedupeHardTimeItems(items: string[]) {
  const normalized = uniqueStrings(items);
  const hasDirectHandBitingWarning = normalized.some(
    (item) => /^do not block hand biting \(he may bite you\)$/i.test(item)
  );

  return normalized.filter((item) => {
    if (
      hasDirectHandBitingWarning &&
      /^do not block hand biting \(it may lead to caregiver injury\)$/i.test(item)
    ) {
      return false;
    }

    return true;
  });
}

function dedupeEnjoymentItems(items: string[]) {
  const normalized = uniqueStrings(items);
  const hasCombinedIpadMusic = normalized.some((item) => /^ipad, music$/i.test(item));

  return normalized.filter((item) => {
    if (hasCombinedIpadMusic && /^(ipad|music)$/i.test(item)) {
      return false;
    }

    return true;
  });
}

function trimSentence(value: string) {
  return compactWhitespace(value).replace(/[.!?]+$/, "");
}

function sentenceCase(value: string) {
  const trimmed = compactWhitespace(value);
  if (!trimmed) {
    return "";
  }

  let normalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  normalized = normalized
    .replace(/\bI[Pp]ad\b/g, "iPad")
    .replace(/\bTouchchat\b/g, "TouchChat")
    .replace(/\bAac\b/g, "AAC");

  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function listFormat(items: string[]) {
  if (items.length === 0) {
    return "";
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function hasSourceMatch(items: string[], pattern: RegExp) {
  return items.some((item) => pattern.test(item));
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 10) {
    return value.trim();
  }

  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function normalizeContactName(value: string) {
  return trimSentence(
    value
      .replace(/^emergency contacts?:\s*/i, "")
      .replace(/^contact\s+/i, "")
      .replace(/'s phone number is.*$/i, "")
      .replace(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g, "")
      .replace(/[()]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function defaultSummaryTitle(nameHint?: string) {
  return nameHint ? `Caring for ${nameHint}` : "Caregiver Handoff Summary";
}

function extractNameFromTitle(value?: string) {
  const match = value?.trim().match(/^Caring for\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function flattenGroupItems(groups: SummaryLabeledGroup[]) {
  return groups.flatMap((group) => {
    const label = `${trimSentence(group.label)}:`;
    const items = group.items.map((item) => sentenceCase(trimSentence(item)));
    return [label, ...items];
  });
}

export function deriveItemsFromBlocks(blocks: SummaryBlock[]) {
  return uniqueStrings(
    blocks.flatMap((block) => {
      if (block.type === "bullets") {
        return block.items.map(sentenceCase);
      }

      if (block.type === "note") {
        return [sentenceCase(block.text)];
      }

      if (block.type === "keyValue") {
        return block.rows.map((row) =>
          sentenceCase(`${trimSentence(row.label)}: ${trimSentence(row.value)}`)
        );
      }

      return flattenGroupItems(block.groups);
    })
  );
}

function normalizeSummaryKeyValueRows(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((row) => {
      const candidate = row as Partial<SummaryKeyValueRow> | undefined;
      const label = compactWhitespace(String(candidate?.label ?? ""));
      const value = compactWhitespace(String(candidate?.value ?? ""));

      if (!label || !value) {
        return null;
      }

      return { label, value } satisfies SummaryKeyValueRow;
    })
    .filter((row): row is SummaryKeyValueRow => Boolean(row));
}

function normalizeSummaryGroups(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((group) => {
      const candidate = group as Partial<SummaryLabeledGroup> | undefined;
      const label = compactWhitespace(String(candidate?.label ?? ""));
      const items = Array.isArray(candidate?.items)
        ? uniqueStrings(
            candidate.items
              .map((item) => compactWhitespace(String(item ?? "")))
              .filter(Boolean)
          )
        : [];

      if (!label || items.length === 0) {
        return null;
      }

      return { label, items } satisfies SummaryLabeledGroup;
    })
    .filter((group): group is SummaryLabeledGroup => Boolean(group));
}

export function normalizeSummaryBlocks(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((block) => {
      const candidate = block as Partial<SummaryBlock> | undefined;
      if (!candidate) {
        return null;
      }

      const type = candidate?.type;

      if (type === "bullets") {
        const items = Array.isArray(candidate.items)
          ? uniqueStrings(
              candidate.items
                .map((item) => compactWhitespace(String(item ?? "")))
                .filter(Boolean)
            )
          : [];

        return items.length > 0 ? ({ type, items } satisfies SummaryBlock) : null;
      }

      if (type === "labeledBullets") {
        const groups = normalizeSummaryGroups(candidate.groups);
        return groups.length > 0 ? ({ type, groups } satisfies SummaryBlock) : null;
      }

      if (type === "keyValue") {
        const rows = normalizeSummaryKeyValueRows(candidate.rows);
        return rows.length > 0 ? ({ type, rows } satisfies SummaryBlock) : null;
      }

      if (type === "note") {
        const text = compactWhitespace(String(candidate.text ?? ""));
        return text ? ({ type, text } satisfies SummaryBlock) : null;
      }

      return null;
    })
    .filter((block): block is SummaryBlock => Boolean(block));
}

export function hydrateStructuredSection(section: Partial<SummarySection>, index: number): SummarySection | null {
  const title = compactWhitespace(String(section.title ?? ""));
  if (!title) {
    return null;
  }

  const intro = compactWhitespace(String(section.intro ?? ""));
  const blocks = normalizeSummaryBlocks(section.blocks);
  const itemsFromBlocks = deriveItemsFromBlocks(blocks);
  const legacyItems = Array.isArray(section.items)
    ? uniqueStrings(section.items.map((item) => sentenceCase(String(item ?? ""))).filter(Boolean))
    : [];
  const items = itemsFromBlocks.length > 0 ? itemsFromBlocks : legacyItems;

  if (!intro && items.length === 0 && blocks.length === 0) {
    return null;
  }

  return {
    id: compactWhitespace(String(section.id ?? "")) || `section-${index + 1}`,
    title,
    intro: intro || undefined,
    items,
    blocks: blocks.length > 0 ? blocks : undefined
  };
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function computeTurnsHash(turns: ConversationTurn[]) {
  const normalized = turns
    .map((turn) =>
      JSON.stringify({
        id: turn.id,
        role: turn.role,
        promptType: turn.promptType,
        promptLabel: turn.promptLabel ?? "",
        sectionTitle: turn.sectionTitle ?? "",
        stepTitle: turn.stepTitle ?? "",
        skipped: Boolean(turn.skipped),
        content: compactWhitespace(turn.content)
      })
    )
    .join("\n");

  return fnv1a(normalized);
}

export function isStructuredSummaryStale(
  summary: StructuredSummary | undefined,
  turns: ConversationTurn[]
) {
  if (!summary) {
    return true;
  }

  return (
    summary.pipelineVersion !== SUMMARY_PIPELINE_VERSION ||
    summary.layoutVersion !== SUMMARY_LAYOUT_VERSION ||
    summary.sourceTurnsHash !== computeTurnsHash(turns)
  );
}

export function getSummaryFreshness(
  turns: ConversationTurn[],
  structuredSummary?: StructuredSummary,
  editedSummary?: StructuredSummary
): SummaryFreshness {
  const generated = structuredSummary
    ? isStructuredSummaryStale(structuredSummary, turns)
      ? "stale"
      : "fresh"
    : "missing";
  const edited = editedSummary
    ? isStructuredSummaryStale(editedSummary, turns)
      ? "stale"
      : "fresh"
    : "missing";

  return {
    generated,
    edited,
    requiresRegeneration: generated !== "fresh" || edited !== "fresh"
  };
}

function inferPronounSet(turns: ConversationTurn[]) {
  const text = turns
    .filter((turn) => turn.role === "user")
    .map((turn) => ` ${turn.content.toLowerCase()} `)
    .join("\n");
  const heScore = (text.match(/\b(he|him|his)\b/g) ?? []).length;
  const sheScore = (text.match(/\b(she|her|hers)\b/g) ?? []).length;
  const theyScore = (text.match(/\b(they|them|their|theirs)\b/g) ?? []).length;

  if (heScore > sheScore && heScore >= theyScore && heScore > 0) {
    return {
      subject: "he",
      object: "him",
      possessive: "his",
      contraction: "he’s",
      enjoysTitle: "What He Enjoys"
    };
  }

  if (sheScore > heScore && sheScore >= theyScore && sheScore > 0) {
    return {
      subject: "she",
      object: "her",
      possessive: "her",
      contraction: "she’s",
      enjoysTitle: "What She Enjoys"
    };
  }

  return {
    subject: "they",
    object: "them",
    possessive: "their",
    contraction: "they’re",
    enjoysTitle: "What They Enjoy"
  };
}

function buildRecordBuckets(summary: LegacySummaryShape) {
  const buckets = new Map<string, LegacyItemRecord[]>();

  for (const title of LEGACY_SECTION_TITLES) {
    buckets.set(title, []);
  }

  for (const section of summary.sections) {
    const title = compactWhitespace(section.title);
    const existing = buckets.get(title) ?? [];
    existing.push(
      ...section.items.map((text, index) => ({
        id: `${title}-${index + 1}-${fnv1a(text)}`,
        text: compactWhitespace(text),
        used: false
      }))
    );
    buckets.set(title, existing);
  }

  return buckets;
}

function takeMatching(records: LegacyItemRecord[], predicate: (value: string) => boolean) {
  return records
    .filter((record) => !record.used && predicate(record.text))
    .map((record) => {
      record.used = true;
      return record.text;
    });
}

function remainingRecords(records: LegacyItemRecord[]) {
  return records
    .filter((record) => !record.used)
    .map((record) => {
      record.used = true;
      return record.text;
    });
}

function buildBulletsSection(
  title: string,
  items: string[],
  options?: { intro?: string }
): SummarySection | null {
  const normalizedItems = uniqueStrings(items.map(sentenceCase).filter(Boolean));
  const intro = compactWhitespace(options?.intro ?? "");

  if (normalizedItems.length === 0 && !intro) {
    return null;
  }

  const blocks: SummaryBlock[] = normalizedItems.length > 0 ? [{ type: "bullets", items: normalizedItems }] : [];

  return {
    id: fnv1a(title),
    title,
    intro: intro || undefined,
    items: normalizedItems,
    blocks
  };
}

function buildKeyValueSection(title: string, rows: SummaryKeyValueRow[]): SummarySection | null {
  const normalizedRows = rows
    .map((row) => ({
      label: compactWhitespace(row.label),
      value: compactWhitespace(row.value)
    }))
    .filter((row) => row.label && row.value);

  if (normalizedRows.length === 0) {
    return null;
  }

  return {
    id: fnv1a(title),
    title,
    items: normalizedRows.map((row) => sentenceCase(`${row.label}: ${row.value}`)),
    blocks: [
      {
        type: "keyValue",
        rows: normalizedRows
      }
    ]
  };
}

function buildGroupedSection(
  title: string,
  groups: SummaryLabeledGroup[],
  options?: { intro?: string; notes?: string[] }
): SummarySection | null {
  const normalizedGroups = groups
    .map((group) => ({
      label: compactWhitespace(group.label),
      items: uniqueStrings(group.items.map(trimSentence).filter(Boolean))
    }))
    .filter((group) => group.label && group.items.length > 0);
  const notes = uniqueStrings((options?.notes ?? []).map(sentenceCase).filter(Boolean));
  const intro = compactWhitespace(options?.intro ?? "");

  if (normalizedGroups.length === 0 && notes.length === 0 && !intro) {
    return null;
  }

  const blocks: SummaryBlock[] = [];

  if (notes.length > 0) {
    blocks.push({ type: "bullets", items: notes });
  }

  if (normalizedGroups.length > 0) {
    blocks.push({
      type: "labeledBullets",
      groups: normalizedGroups
    });
  }

  return {
    id: fnv1a(title),
    title,
    intro: intro || undefined,
    items: deriveItemsFromBlocks(blocks),
    blocks
  };
}

function mentionName(name: string, fallback: string) {
  return name ? name : fallback;
}

function capitalizeWord(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function buildPrimaryContactValue(items: string[]) {
  const first = items[0];
  if (!first) {
    return "";
  }

  const phone = first.match(/(\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})/);
  const name = trimSentence(
    (first.split(",")[0] ?? first)
      .replace(/^emergency contacts?:\s*/i, "")
      .replace(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/, "")
      .replace(/[()]/g, "")
  );

  if (name && phone?.[1]) {
    return `${name.trim()} (${normalizePhone(phone[1])})`;
  }

  return sentenceCase(first).replace(/[.]$/, "");
}

function buildCommunicationOverviewValue(items: string[]) {
  const parts: string[] = [];

  if (items.some((item) => /\bnon-speaking\b/i.test(item))) {
    parts.push("Non-speaking");
  }

  if (items.some((item) => /\bAAC|Touch ?Chat|iPad\b/i.test(item))) {
    if (items.some((item) => /\bTouch ?Chat\b/i.test(item)) && items.some((item) => /\biPad\b/i.test(item))) {
      parts.push("uses AAC (TouchChat on iPad)");
    } else {
      parts.push("uses AAC");
    }
  }

  if (parts.length === 0 && items[0]) {
    return sentenceCase(items[0]).replace(/[.]$/, "");
  }

  return parts.join(", ");
}

function buildKeyNeedsValue(allItems: string[]) {
  const needs: string[] = [];

  if (allItems.some((item) => /\b(food|hungry|cheese|fridge|meal|eat)\b/i.test(item))) {
    needs.push("constant food access");
  }

  if (allItems.some((item) => /\b(supervision|two caregivers?|two people|safety|close supervision)\b/i.test(item))) {
    needs.push("supervision for safety");
  }

  if (
    allItems.some((item) =>
      /\b(visual|2-step|two-step|routine|structured|schedule|timer|prompts?)\b/i.test(item)
    )
  ) {
    needs.push("structured support");
  }

  return listFormat(needs.slice(0, 3));
}

function buildTopRisksValue(allItems: string[]) {
  const risks: string[] = [];

  if (allItems.some((item) => /\belope|run away\b/i.test(item))) {
    risks.push("elopement");
  }

  if (allItems.some((item) => /\b(hand biting|biting his hand|biting her hand|biting their hand)\b/i.test(item))) {
    risks.push("self-injury (hand biting)");
  }

  if (allItems.some((item) => /\bpica\b/i.test(item))) {
    risks.push("pica");
  }

  if (allItems.some((item) => /\bwalks?|outings?\b/i.test(item) && /\btwo caregivers?|two people|unsafe|safety\b/i.test(item))) {
    risks.push("unsafe walking");
  }

  if (allItems.some((item) => /\bdoes not communicate pain|does not tell you if he is hurt|does not tell you if she is hurt|does not tell you if they are hurt\b/i.test(item))) {
    risks.push("does not communicate pain");
  }

  return listFormat(risks.slice(0, 4));
}

function buildBestSupportsValue(allItems: string[]) {
  const supports: string[] = [];

  if (allItems.some((item) => /\bvisual|pictures?|show him|show her|show them\b/i.test(item))) {
    supports.push("visuals");
  }

  if (allItems.some((item) => /\b2-step|two-step\b/i.test(item))) {
    supports.push("2-step directions");
  }

  if (allItems.some((item) => /\bgiv(?:e|ing)\b.*\bspace\b|\bspace immediately\b|\btime alone\b/i.test(item))) {
    supports.push("space when overwhelmed");
  }

  if (allItems.some((item) => /\bquiet|low-light|low light|reduce noise|dim\b/i.test(item))) {
    supports.push("quiet, low-light environment");
  }

  return listFormat(supports.slice(0, 4));
}

function simplifyCommunicationItem(item: string, pronoun: ReturnType<typeof inferPronounSet>) {
  if (/\bnon-speaking\b/i.test(item)) {
    return "Non-speaking";
  }

  if (/\bask(?:s)? for help\b/i.test(item)) {
    return "Ask for help";
  }

  if (/\b(selects?|request(?:s)?)\b/i.test(item) && /\b(car|ipad)\b/i.test(item)) {
    return 'Request items (e.g., "iPad" or "car")';
  }

  if (/\blead\b/i.test(item) && /\battention\b/i.test(item)) {
    return `Lead you to what ${pronoun.subject} needs or sit close when ${pronoun.subject} wants attention`;
  }

  if (/\blead\b/i.test(item)) {
    return `Lead you to what ${pronoun.subject} needs`;
  }

  if (/\bsit(?:ting)? very close|sit close|attention\b/i.test(item)) {
    return `Sit close when ${pronoun.subject} wants attention`;
  }

  if (/\bhappy sounds?|singing\b/i.test(item) && /\bangry sounds?|loud|upset\b/i.test(item)) {
    return "Happy sounds, singing";
  }

  if (/\bhappy sounds?|singing\b/i.test(item)) {
    return "Happy sounds, singing";
  }

  if (/\bangry sounds?|loud|angry vocalizations?\b/i.test(item)) {
    return "Loud/angry sounds when upset";
  }

  if (/\bdoes not\b/i.test(item) && /\b(hurt|pain|bathroom)\b/i.test(item)) {
    return "Does not tell you if he is hurt or needs the bathroom";
  }

  return "";
}

function collectCommunicationUses(items: string[]) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\bask(?:s)? for help\b/i)) {
    results.push("Ask for help");
  }

  if (
    hasSourceMatch(
      items,
      /\b(request(?:s)? items?|label things|select(?:s)? (?:the word )?(?:ipad|car)|i want ipad)\b/i
    )
  ) {
    results.push('Request items (e.g., "iPad" or "car")');
  }

  return results;
}

function collectCommunicationWill(items: string[], pronoun: ReturnType<typeof inferPronounSet>) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\blead\b|\btouch you\b/i)) {
    results.push(`Lead you to what ${pronoun.subject} needs`);
  }

  if (hasSourceMatch(items, /\bsit(?:ting)? next to you\b|\bsit close\b|\bcloser and closer\b|\battention\b/i)) {
    results.push(`Sit close when ${pronoun.subject} wants attention`);
  }

  return results;
}

function collectCommunicationSounds(items: string[]) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\bhappy sounds?\b|\bsinging\b/i)) {
    results.push("Happy sounds, singing");
  }

  if (hasSourceMatch(items, /\bangry sounds?\b|\bangry noises?\b|\byelling\b|\bloud\b.*\bupset\b/i)) {
    results.push("Loud/angry sounds when upset");
  }

  return results;
}

function collectCommunicationImportant(items: string[], pronoun: ReturnType<typeof inferPronounSet>) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\bdoes not\b.*\b(hurt|pain|bathroom)\b|\bdoes not communicate when .* bathroom\b/i)) {
    results.push(`Does NOT tell you if ${pronoun.subject} is hurt or needs the bathroom`);
  }

  return results;
}

function simplifySignItem(item: string) {
  if (/\blimp|avoiding body parts?\b/i.test(item)) {
    return "Limping or avoiding body parts";
  }

  if (/\bnot eating|not drinking\b/i.test(item)) {
    return "Not eating or drinking";
  }

  if (/\blow energy|letharg/i.test(item)) {
    return "Low energy (unusual for him)";
  }

  if (/\belope|run away\b/i.test(item)) {
    return "Eloping (running away)";
  }

  if (/\bhand biting|biting his hand|biting her hand|biting their hand\b/i.test(item)) {
    return "Hand biting";
  }

  if (/\bangry sounds?|loud or angry vocalizations?|yelling\b/i.test(item)) {
    return "Angry vocalizations";
  }

  if (/\bhiding\b/i.test(item) && /\bgrunting|bowel\b/i.test(item)) {
    return "Hiding (may be using the bathroom)";
  }

  if (/\bhelp\b/i.test(item) && /\bdevice|aac|ipad\b/i.test(item)) {
    return 'Presses "help" on device';
  }

  return "";
}

function simplifyCommunicationSignItem(item: string) {
  if (/\bhelp\b/i.test(item) && /\bdevice|aac|ipad\b/i.test(item)) {
    return 'Presses "help" on device';
  }

  return "";
}

function simplifyHardTimeItem(item: string) {
  if (/\bsqueeze\b/i.test(item) && /\brelease\b/i.test(item)) {
    return '"Squeeze and release"';
  }

  if (/\bdeep breath/i.test(item)) {
    return "Deep breaths";
  }

  if (/\bcount to 10\b/i.test(item)) {
    return "Count to 10";
  }

  if (/\bgiv(?:e|ing)\b.*\bspace\b/i.test(item)) {
    return "Give space immediately";
  }

  if (/\breduce noise|quiet|low stimulation|stimulation\b/i.test(item)) {
    return "Reduce noise and stimulation";
  }

  if (/\bdo not\b/i.test(item) && /\bblock|physically stop\b/i.test(item) && /\bbiting|hand\b/i.test(item)) {
    return "Do NOT block hand biting (he may bite you)";
  }

  if (/\bcar rides?\b/i.test(item)) {
    return "Car ride (very effective)";
  }

  if (/\btime alone\b/i.test(item)) {
    return "Time alone";
  }

  if (/\bquiet environment\b/i.test(item) || /\bquiet\b/i.test(item)) {
    return "Quiet environment";
  }

  return "";
}

function simplifyDailyNeedItem(item: string) {
  if (/\bhourly|regular bathroom reminders?|prompted every hour|every hour\b/i.test(item)) {
    return "Needs to be prompted every hour";
  }

  if (/\bdoes not independently communicate toileting needs|does not initiate|won't use it independently|does not communicate when he needs the bathroom\b/i.test(item)) {
    return "Does not initiate";
  }

  if (/\bpull-?up\b/i.test(item) && /\bbowel\b/i.test(item)) {
    return "Happens in pull-up";
  }

  if (/\bhiding\b/i.test(item) && /\bgrunting|bowel\b/i.test(item)) {
    return "He hides and grunts";
  }

  if (/\bfood\b/i.test(item) && /\bconstant|often|regular access|frequent access|grazes\b/i.test(item)) {
    return "Eats small amounts constantly";
  }

  if (/\blimited diet\b/i.test(item) || /\bbite-sized\b/i.test(item) || /\bprep(?:ped|ared)?\b/i.test(item)) {
    return "Limited diet (prepared foods)";
  }

  if (/\bcheese\b/i.test(item) && /\bindependently|get\b/i.test(item)) {
    return "Will independently get cheese if hungry";
  }

  return "";
}

function simplifySupportItem(item: string) {
  if (/\bvisual|pictures?|show him|show her|show them\b/i.test(item)) {
    return "Visual choices (show items or pictures)";
  }

  if (/\b2-step|two-step\b/i.test(item)) {
    return "Use 2-step directions only";
  }

  if (/\bfood\b/i.test(item) && /\bprevent distress|regular access|constant|hungry\b/i.test(item)) {
    return "Keep food available (he is always hungry)";
  }

  if (/\bquiet|low light|low-light|dim\b/i.test(item)) {
    return "Quiet, low-light environment";
  }

  if (/\broutine|structured|visual timer|visual schedule\b/i.test(item)) {
    return "Structured routine";
  }

  return "";
}

function collectSupportItems(items: string[]) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\bvisual\b|\bpictures?\b|\bshow him\b|\bshow her\b|\bshow them\b/i)) {
    results.push("Visual choices (show items or pictures)");
  }

  if (hasSourceMatch(items, /\b2-step\b|\btwo-step\b|\bfirst this, then that\b/i)) {
    results.push("Use 2-step directions only");
  }

  if (hasSourceMatch(items, /\bfood\b.*\b(constant|constantly|available)\b|\balways hungry\b|\bfood with him all the time\b/i)) {
    results.push("Keep food available (he is always hungry)");
  }

  if (hasSourceMatch(items, /\bquiet\b|\blow light\b|\blow-light\b|\bsoft indirect lighting\b|\boverhead lighting\b/i)) {
    results.push("Quiet, low-light environment");
  }

  if (hasSourceMatch(items, /\bstructured\b|\broutine\b|\bvisual timer\b|\bvisual schedule\b/i)) {
    results.push("Structured routine");
  }

  return results;
}

function simplifyTriggerItem(item: string) {
  if (/\bloud noise|crowds?|too many people\b/i.test(item)) {
    return "Loud noise, crowds";
  }

  if (/\bbright|overhead lighting\b/i.test(item)) {
    return "Bright or overhead lighting";
  }

  if (/\bthings moved|out of place\b/i.test(item)) {
    return "Changes in environment (things moved)";
  }

  if (/\bshades\b/i.test(item) || /\blights?\b/i.test(item) && /\bup or down|position\b/i.test(item)) {
    return "Lights or shades not in expected position";
  }

  if (/\bhunger|food available|food with him all the time\b/i.test(item)) {
    return "Hunger";
  }

  if (/\bstopping an activity|transition\b/i.test(item)) {
    return "Too many demands at once";
  }

  return "";
}

function collectTriggerItems(items: string[]) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\bloud noise\b|\bcrowds?\b|\btoo many people\b|\bchaotic\b/i)) {
    results.push("Loud noise, crowds");
  }

  if (hasSourceMatch(items, /\bbright lights?\b|\boverhead lighting\b/i)) {
    results.push("Bright or overhead lighting");
  }

  if (hasSourceMatch(items, /\bout of place\b|\bmoved\b/i)) {
    results.push("Changes in environment (things moved)");
  }

  if (hasSourceMatch(items, /\bshades?\b.*\bup\b|\bshades?\b.*\bdown\b|\blights?\b.*\bon and off\b|\blights?\b.*\bposition\b/i)) {
    results.push("Lights/shades not in expected position");
  }

  if (hasSourceMatch(items, /\bhungry\b|\bhunger\b|\bfood runs out\b|\bfood with him all the time\b/i)) {
    results.push("Hunger");
  }

  if (hasSourceMatch(items, /\btoo many demands\b|\bmore than two steps\b|\basked to wait\b|\bwait\b|\btransition\b/i)) {
    results.push("Too many demands at once");
  }

  return results;
}

function simplifyMedicationItem(item: string) {
  if (/\baripiprazole|abilify\b/i.test(item)) {
    return "Abilify (Aripiprazole) - 3pm daily";
  }

  if (/\bmiralax|gavilax|clearlax|polyethylene glycol\b/i.test(item)) {
    return "Miralax - in water daily";
  }

  if (/\bmultivitamin|gummy\b/i.test(item)) {
    return "Multivitamin gummies";
  }

  return trimSentence(item);
}

function collectMedicationItems(items: string[]) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\baripiprazole|abilify\b/i)) {
    results.push("Abilify (Aripiprazole) - 3pm daily");
  }

  if (hasSourceMatch(items, /\bmiralax|gavilax|clearlax|polyethylene glycol\b/i)) {
    results.push("Miralax - in water daily");
  }

  if (hasSourceMatch(items, /\bmultivitamin|gummy vites|gummy\b/i)) {
    results.push("Multivitamin gummies");
  }

  return results;
}

function simplifyEquipmentItem(item: string) {
  if (/\bTouchChat|AAC|iPad\b/i.test(item)) {
    return "AAC device (iPad with TouchChat)";
  }

  if (/\bnoise\b/i.test(item) && /\bheadphones\b/i.test(item)) {
    return "Noise-canceling headphones";
  }

  if (/\bfidgets?\b/i.test(item)) {
    return "Fidgets (needs something in hand)";
  }

  if (/\bpull-?ups?\b/i.test(item)) {
    return "Pull-ups";
  }

  if (/\bbuckle buddy\b/i.test(item)) {
    return "Buckle Buddy (car safety)";
  }

  if (/\bwhite cane\b/i.test(item)) {
    return "White cane (in training)";
  }

  return trimSentence(item);
}

function collectEquipmentItems(items: string[]) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\bTouchChat\b|\bAAC\b|\biPad\b/i)) {
    results.push("AAC device (iPad with TouchChat)");
  }

  if (hasSourceMatch(items, /\bnoise\b.*\bheadphones\b|\bnoise cancelling headphones\b/i)) {
    results.push("Noise-canceling headphones");
  }

  if (hasSourceMatch(items, /\bfidgets?\b/i)) {
    results.push("Fidgets (needs something in hand)");
  }

  if (hasSourceMatch(items, /\bpull-?ups?\b/i)) {
    results.push("Pull-ups");
  }

  if (hasSourceMatch(items, /\bbuckle buddy\b/i)) {
    results.push("Buckle Buddy (car safety)");
  }

  if (hasSourceMatch(items, /\bwhite cane\b/i)) {
    results.push("White cane (in training)");
  }

  return results;
}

function simplifySafetyItem(item: string) {
  if (/^\s*no allergies?\.?\s*$/i.test(item)) {
    return "";
  }

  if (/^[A-Z][a-z]+\s+[A-Z][a-z]+\.?$/i.test(item)) {
    return "";
  }

  if (/\belopement\b/i.test(item) || /\belope|run away\b/i.test(item)) {
    return "Elopement risk";
  }

  if (/\btwo caregivers?|two people\b/i.test(item) && /\bwalks?|outings?|car rides?\b/i.test(item)) {
    return "Needs 2 adults for walks or outings";
  }

  if (/\btwo caregivers?|two people\b/i.test(item) && /\bsafety reasons?\b/i.test(item)) {
    return "Needs 2 adults for walks or outings";
  }

  if (/\bpica\b/i.test(item)) {
    return "Pica (may put unsafe items in mouth)";
  }

  if (/\bdoes not communicate pain|does not tell you if he is hurt|does not tell you if she is hurt|does not tell you if they are hurt\b/i.test(item)) {
    return "Does not communicate pain";
  }

  if (/\bunsafe\b/i.test(item) || /\bdysregulated\b/i.test(item) || /\bmay bite you\b/i.test(item) || /\bbite you\b/i.test(item)) {
    return "Can become physically unsafe when dysregulated";
  }

  return "";
}

function collectSafetyItems(items: string[]) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\belopement\b|\belope\b|\brun away\b/i)) {
    results.push("Elopement risk");
  }

  if (hasSourceMatch(items, /\btwo caregivers?\b|\btwo people\b|\bmore than one person\b/i)) {
    results.push("Needs 2 adults for walks or outings");
  }

  if (hasSourceMatch(items, /\bpica\b/i)) {
    results.push("Pica (may put unsafe items in mouth)");
  }

  if (
    hasSourceMatch(
      items,
      /\bdoes not communicate pain\b|\bdoesn.?t let you know if .* hurt\b|\bdoes not let you know if .* hurt\b|\bdoes not tell you if .* hurt\b|\bin pain\b/i
    )
  ) {
    results.push("Does not communicate pain");
  }

  if (hasSourceMatch(items, /\bdysregulated\b|\bmay bite you\b|\bbite you\b|\bphysically unsafe\b|\bself-harm\b/i)) {
    results.push("Can become physically unsafe when dysregulated");
  }

  return results;
}

function simplifyConditionItem(item: string) {
  if (/\bautism spectrum disorder|autism\b/i.test(item)) {
    return "Autism spectrum disorder";
  }

  if (/\bcerebral visual impairment|cvi\b/i.test(item)) {
    return "Cerebral visual impairment (CVI)";
  }

  if (/\bpica\b/i.test(item)) {
    return "Pica";
  }

  if (/\blanguage regression\b/i.test(item)) {
    return "Language regression";
  }

  if (/\bmixed receptive-expressive language disorder\b/i.test(item)) {
    return "Mixed receptive-expressive language disorder";
  }

  if (/\bsensory processing difficulty\b/i.test(item)) {
    return "Sensory processing difficulty";
  }

  if (/\bglobal developmental delay\b/i.test(item)) {
    return "Global developmental delay";
  }

  if (/\bapraxia of speech\b/i.test(item)) {
    return "Apraxia of speech";
  }

  return trimSentence(item).replace(/[:,-]\s*diagnosed\b.*$/i, "").trim();
}

function collectConditionItems(items: string[]) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\bautism spectrum disorder|autism\b/i)) {
    results.push("Autism spectrum disorder");
  }

  if (hasSourceMatch(items, /\bcerebral visual impairment|cvi\b/i)) {
    results.push("Cerebral visual impairment (CVI)");
  }

  if (hasSourceMatch(items, /\blanguage regression\b/i)) {
    results.push("Language regression");
  }

  if (hasSourceMatch(items, /\bmixed receptive-expressive language disorder\b/i)) {
    results.push("Mixed receptive-expressive language disorder");
  }

  if (hasSourceMatch(items, /\bsensory processing difficulty\b/i)) {
    results.push("Sensory processing difficulty");
  }

  if (hasSourceMatch(items, /\bglobal developmental delay\b/i)) {
    results.push("Global developmental delay");
  }

  if (hasSourceMatch(items, /\bapraxia of speech\b/i)) {
    results.push("Apraxia of speech");
  }

  return results;
}

function simplifyContactItem(item: string) {
  const normalized = item.replace(/^emergency contacts?:\s*/i, "").trim();
  const phone = normalized.match(/(\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})/);
  const name = normalizeContactName(normalized.split(",")[0] ?? normalized);

  if (name && phone?.[1]) {
    return `${name} (${normalizePhone(phone[1])})`;
  }

  return "";
}

function extractContactItems(items: string[]) {
  const contacts = new Map<string, string>();

  for (const item of items) {
    const normalized = item.replace(/^emergency contacts?:\s*/i, "").trim();
    const matches = [
      ...normalized.matchAll(
        /([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+),[^0-9]*?(\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})/g
      )
    ];

    if (matches.length > 0) {
      for (const match of matches) {
        const name = normalizeContactName(match[1] ?? "");
        const phone = normalizePhone(match[2] ?? "");
        if (name && phone) {
          contacts.set(`${name.toLowerCase()}::${phone}`, `${name} (${phone})`);
        }
      }
      continue;
    }

    const simplified = simplifyContactItem(item);
    if (simplified) {
      const normalizedContact = simplified.replace(
        /(\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})/,
        (_, phone: string) => normalizePhone(phone)
      );
      const match = normalizedContact.match(/^(.*)\s+\((\d{3}-\d{3}-\d{4})\)$/);
      if (match?.[1] && match[2]) {
        const name = normalizeContactName(match[1]);
        const phone = normalizePhone(match[2]);
        if (name && phone) {
          contacts.set(`${name.toLowerCase()}::${phone}`, `${name} (${phone})`);
        }
      }
    }
  }

  return [...contacts.values()];
}

function simplifyEnjoymentItem(item: string) {
  if (/\bipad\b/i.test(item) && /\bmusic\b/i.test(item)) {
    return "iPad, music";
  }

  if (/\bipad\b/i.test(item)) {
    return "iPad";
  }

  if (/\bmusic\b/i.test(item)) {
    return "Music";
  }

  if (/\bcar rides?\b/i.test(item)) {
    return "Car rides";
  }

  if (/\bhorseback\b/i.test(item)) {
    return "Horseback riding";
  }

  if (/\bexploring|new places|novelty\b/i.test(item)) {
    return "Exploring new places";
  }

  if (/\bwalking|walks?|jumping|swinging|movement|keep moving|scooter|swimming\b/i.test(item)) {
    return "Movement (walking, jumping, swinging)";
  }

  return "";
}

function collectEnjoymentItems(items: string[]) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\bipad\b|\bmusic\b/i)) {
    results.push("iPad, music");
  }

  if (hasSourceMatch(items, /\bcar rides?\b/i)) {
    results.push("Car rides");
  }

  if (hasSourceMatch(items, /\bwalking\b|\bwalks?\b|\bjumping\b|\bswinging\b|\bmovement\b|\bscooter\b|\bswimming\b/i)) {
    results.push("Movement (walking, jumping, swinging)");
  }

  if (hasSourceMatch(items, /\bhorseback\b/i)) {
    results.push("Horseback riding");
  }

  if (hasSourceMatch(items, /\bexploring\b|\bnew places\b|\bnovelty\b/i)) {
    results.push("Exploring new places");
  }

  return results;
}

function isMedicationItem(item: string) {
  return /\b(aripiprazole|abilify|miralax|gavilax|clearlax|polyethylene glycol|multivitamin|gummy vites|medication|medicine)\b/i.test(
    item
  );
}

function isEquipmentItem(item: string) {
  return /\b(aac|ipad|touchchat|headphones|fidgets?|pull-?ups?|buckle buddy|white cane|equipment|supports?)\b/i.test(
    item
  );
}

function isHealthConditionItem(item: string) {
  return /\b(autism|cerebral visual impairment|cvi|pica|regression|language disorder|sensory processing|developmental delay|apraxia|condition|diagnosed)\b/i.test(
    item
  );
}

function isLeisureItem(item: string) {
  return /\b(enjoy|likes?|ipad|music|car rides?|walking|jumping|swinging|horseback|swimming|exploring|videos?)\b/i.test(
    item
  );
}

function isCommunicationSupportItem(item: string) {
  return /\b(visual|2-step|two-step|food|routine|quiet|low-light|low light)\b/i.test(item);
}

function isEarlySupportItem(item: string) {
  return /\b(squeeze|release|deep breath|count to 10)\b/i.test(item);
}

function isResetSupportItem(item: string) {
  return /\b(car rides?|quiet|time alone)\b/i.test(item);
}

function isPhysicalSignItem(item: string) {
  return /\b(limp|body parts?|not eating|not drinking|low energy|letharg|pain|hurt)\b/i.test(item);
}

function isCommunicationSignItem(item: string) {
  return /\b(help\b.*(?:device|aac|ipad)|press(?:es)? help|ask(?:s)? for help)\b/i.test(item);
}

function isBehavioralSignItem(item: string) {
  return /\b(elope|run away|hand biting|angry|yelling|hiding|grunting|fridge|cheese|attention|lead)\b/i.test(item);
}

function collectPhysicalSigns(items: string[]) {
  const results: string[] = [];

  if (items.some((item) => /\blimp|avoiding body parts?\b/i.test(item))) {
    results.push("Limping or avoiding body parts");
  }

  if (items.some((item) => /\bnot eating|not drinking\b/i.test(item))) {
    results.push("Not eating or drinking");
  }

  if (items.some((item) => /\blow energy|letharg/i.test(item))) {
    results.push("Low energy (unusual for him)");
  }

  return results;
}

function collectBehavioralSigns(items: string[]) {
  const results: string[] = [];

  if (items.some((item) => /\belope|run away\b/i.test(item))) {
    results.push("Eloping (running away)");
  }

  if (items.some((item) => /\bhand biting|biting his hand|biting her hand|biting their hand\b/i.test(item))) {
    results.push("Hand biting");
  }

  if (items.some((item) => /\bangry sounds?|loud or angry vocalizations?|yelling\b/i.test(item))) {
    results.push("Angry vocalizations");
  }

  if (items.some((item) => /\bhiding\b/i.test(item) && /\bgrunting|bowel\b/i.test(item))) {
    results.push("Hiding (may be using the bathroom)");
  }

  return results;
}

function collectCommunicationSigns(items: string[]) {
  const results: string[] = [];

  if (items.some((item) => /\bhelp\b/i.test(item) && /\bdevice|aac|ipad\b/i.test(item))) {
    results.push('Presses "help" on device');
  }

  return results;
}

function collectEarlyHardTimeItems(items: string[]) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\bsqueeze\b.*\brelease\b/i)) {
    results.push('"Squeeze and release"');
  }

  if (hasSourceMatch(items, /\bdeep breath/i)) {
    results.push("Deep breaths");
  }

  if (hasSourceMatch(items, /\bcount to 10\b/i)) {
    results.push("Count to 10");
  }

  return results;
}

function collectEscalatedHardTimeItems(items: string[]) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\bgiv(?:e|ing)\b.*\bspace\b|\ba moment to himself\b|\btime to calm down\b/i)) {
    results.push("Give space immediately");
  }

  if (hasSourceMatch(items, /\bquiet\b|\breduce noise\b|\bstimulation\b|\bthere isn.t a lot going around\b/i)) {
    results.push("Reduce noise and stimulation");
  }

  if (hasSourceMatch(items, /\bdo not\b.*\bstop\b.*\bbiting\b|\bdo not\b.*\bblock\b.*\bbiting\b|\bbite you\b/i)) {
    results.push("Do NOT block hand biting (he may bite you)");
  }

  return results;
}

function collectResetItems(items: string[]) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\bcar rides?\b/i)) {
    results.push("Car ride (very effective)");
  }

  if (hasSourceMatch(items, /\bquiet environment\b|\bquiet\b/i)) {
    results.push("Quiet environment");
  }

  if (hasSourceMatch(items, /\btime alone\b|\bmoment to himself\b|\bleft alone\b/i)) {
    results.push("Time alone");
  }

  return results;
}

function collectBathroomItems(items: string[]) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\bhourly\b|\bevery hour\b|\bremind him to go use the bathroom\b/i)) {
    results.push("Needs to be prompted every hour");
  }

  if (hasSourceMatch(items, /\bwon.t use it independently\b|\bdoes not initiate\b|\bdoes not communicate when .* bathroom\b/i)) {
    results.push("Does not initiate");
  }

  if (hasSourceMatch(items, /\bbowel movements?\b.*\bnot\b.*\btoilet\b|\bpull-?up\b/i)) {
    results.push("Happens in pull-up");
  }

  if (hasSourceMatch(items, /\bdisappears\b|\bhiding\b|\bgrunting\b|\bprivacy\b/i)) {
    results.push("He hides and grunts");
  }

  return results;
}

function collectEatingItems(items: string[]) {
  const results: string[] = [];

  if (hasSourceMatch(items, /\bgrazes\b|\bfood constantly\b|\bsmall amounts constantly\b|\bwalking by all day\b/i)) {
    results.push("Eats small amounts constantly");
  }

  if (hasSourceMatch(items, /\blimited diet\b|\bbite-sized\b|\bprepared foods\b|\bpack gavin pasta\b/i)) {
    results.push("Limited diet (prepared foods)");
  }

  if (hasSourceMatch(items, /\bget cheese for himself\b|\bgrabbing cheese\b/i)) {
    results.push("Will independently get cheese if hungry");
  }

  return results;
}

function buildSectionTitleSet(summary: LegacySummaryShape, turns: ConversationTurn[]) {
  const name = extractNameFromTitle(summary.title);
  const pronoun = inferPronounSet(turns);
  const subjectTitle = capitalizeWord(pronoun.subject);
  const objectTitle = capitalizeWord(pronoun.object);

  return {
    name,
    pronoun,
    communication: `How ${mentionName(name, "They")} ${name ? "Communicates" : "Communicate"}`,
    triggers: `What Can Upset or Overwhelm ${objectTitle}`,
    signs: `Signs ${subjectTitle} Needs Help`,
    hardTime: `What to Do When ${capitalizeWord(pronoun.contraction)} Upset`,
    enjoyment: pronoun.enjoysTitle
  };
}

function createRow(label: string, value: string) {
  const normalizedValue = compactWhitespace(value);
  return normalizedValue ? { label, value: normalizedValue } : null;
}

export function composeStructuredSummaryLayout(
  legacySummary: LegacySummaryShape,
  turns: ConversationTurn[],
  nameHint?: string
): StructuredSummary {
  const summaryTitle = compactWhitespace(legacySummary.title) || defaultSummaryTitle(nameHint);
  const buckets = buildRecordBuckets(legacySummary);
  const titleSet = buildSectionTitleSet({ ...legacySummary, title: summaryTitle }, turns);
  const communicationRecords = buckets.get("Communication") ?? [];
  const dailyRecords = buckets.get("Daily Needs & Routines") ?? [];
  const dayRecords = buckets.get("What helps the day go well") ?? [];
  const upsetRecords = buckets.get("What can upset or overwhelm them") ?? [];
  const signRecords = buckets.get("Signs they need help") ?? [];
  const hardTimeRecords = buckets.get("What helps when they are having a hard time") ?? [];
  const healthRecords = buckets.get("Health & Safety") ?? [];
  const contactRecords = buckets.get("Who to contact (and when)") ?? [];
  const rawItems = turns
    .filter((turn) => turn.role === "user" && !turn.skipped)
    .map((turn) => compactWhitespace(normalizeSourceText(turn.content)))
    .filter(Boolean);
  const rawFragments = turns
    .filter((turn) => turn.role === "user" && !turn.skipped)
    .flatMap((turn) => splitSourceFragments(turn.content));
  const allItems = uniqueStrings([
    ...legacySummary.sections.flatMap((section) => section.items),
    ...rawItems,
    ...rawFragments
  ]);
  const contactItems = extractContactItems([
    ...contactRecords.map((record) => record.text),
    ...allItems.filter((item) => /\bcontacts?\b|\bmother\b|\bgrandmother\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/i.test(item))
  ]);

  const quickOverview = buildKeyValueSection(
    "Quick Overview",
    [
      createRow("Communication", buildCommunicationOverviewValue(allItems)),
      createRow("Key Needs", buildKeyNeedsValue(allItems)),
      createRow("Top Risks", buildTopRisksValue(allItems)),
      createRow("Best Supports", buildBestSupportsValue(allItems)),
      createRow("Emergency Contact", buildPrimaryContactValue(contactItems))
    ].filter((row): row is SummaryKeyValueRow => Boolean(row))
  );

  const communicationSection = buildGroupedSection(
    titleSet.communication,
    [
      {
        label: "Uses AAC device to",
        items: dedupeCommunicationUseItems([
          ...takeMatching(
            communicationRecords,
            (item) => /\b(ask for help|selects?|request|label things|i want ipad)\b/i.test(item)
          )
            .map((item) => simplifyCommunicationItem(item, titleSet.pronoun))
            .filter(Boolean),
          ...collectCommunicationUses(allItems)
        ])
      },
      {
        label: "Will",
        items: dedupeCommunicationWillItems([
          ...takeMatching(
            communicationRecords,
            (item) => /\b(lead|touch|attention|sit close)\b/i.test(item)
          )
            .map((item) => simplifyCommunicationItem(item, titleSet.pronoun))
            .filter(Boolean),
          ...collectCommunicationWill(allItems, titleSet.pronoun)
        ])
      },
      {
        label: "Sounds",
        items: dedupeCommunicationSoundItems([
          ...takeMatching(
            communicationRecords,
            (item) => /\b(sound|singing|angry|happy)\b/i.test(item)
          )
            .map((item) => simplifyCommunicationItem(item, titleSet.pronoun))
            .filter(Boolean),
          ...collectCommunicationSounds(allItems)
        ])
      },
      {
        label: "Important",
        items: uniqueStrings(
          [
            ...takeMatching(communicationRecords, (item) => /\b(does not|bathroom|hurt|pain)\b/i.test(item)),
            ...dailyRecords
              .map((record) => record.text)
              .filter((item) => /\b(does not|bathroom|hurt|pain)\b/i.test(item))
          ]
            .map((item) => simplifyCommunicationItem(item, titleSet.pronoun))
            .filter(Boolean)
            .concat(collectCommunicationImportant(allItems, titleSet.pronoun))
        )
      }
    ],
    {
      intro: "Keep only the most useful signals"
    }
  );

  const preferredActivities = dedupeEnjoymentItems(
    allItems.map(simplifyEnjoymentItem).filter(Boolean)
  ).slice(0, 5);
  const preferredActivityItems = dedupeEnjoymentItems([
    ...collectEnjoymentItems(allItems).filter(
      (item) => !/horseback riding|exploring new places/i.test(item)
    ),
    ...preferredActivities
  ]).slice(0, 4);
  const dayGoWellSection = buildGroupedSection(
    "What Helps the Day Go Well",
    preferredActivityItems.length > 0
      ? [
          {
            label: "Preferred activities",
            items: preferredActivityItems
          }
        ]
      : [],
    {
      intro: "(This is your success blueprint)",
      notes: [
        ...takeMatching(
          dayRecords,
          (item) =>
            /\b(visual|pictures?|2-step|two-step|food|hungry|quiet|low light|low-light|routine|structured)\b/i.test(
              item
            )
        )
          .map(simplifySupportItem)
          .filter(Boolean),
        ...takeMatching(
          dailyRecords,
          (item) => /\b(food|bathroom reminders?|structured|routine|visual timer|visual schedule)\b/i.test(item)
        )
          .map(simplifySupportItem)
          .filter(Boolean),
        ...allItems
          .filter((item) => /\b(food|hungry)\b/i.test(item))
          .map(simplifySupportItem)
          .filter(Boolean),
        ...collectSupportItems(allItems)
      ]
    }
  );

  const triggerSection = buildBulletsSection(
    titleSet.triggers,
    uniqueStrings([
      ...takeMatching(upsetRecords, () => true).map(simplifyTriggerItem).filter(Boolean),
      ...takeMatching(dayRecords, (item) => /\btrigger|upset|overwhelm|hard|transition\b/i.test(item))
        .map(simplifyTriggerItem)
        .filter(Boolean),
      ...collectTriggerItems(allItems)
    ])
  );

  const signsSection = buildGroupedSection(titleSet.signs, [
    {
      label: "Physical",
      items: uniqueStrings([
        ...takeMatching(signRecords, isPhysicalSignItem).map(simplifySignItem).filter(Boolean),
        ...collectPhysicalSigns(allItems)
      ])
    },
    {
      label: "Behavioral",
      items: uniqueStrings([
        ...takeMatching(signRecords, isBehavioralSignItem).map(simplifySignItem).filter(Boolean),
        ...collectBehavioralSigns(allItems)
      ])
    },
    {
      label: "Communication",
      items: uniqueStrings([
        ...takeMatching(signRecords, isCommunicationSignItem)
          .map(simplifyCommunicationSignItem)
          .filter(Boolean),
        ...collectCommunicationSigns(allItems)
      ])
    }
  ]);

  const hardTimeSection = buildGroupedSection(titleSet.hardTime, [
    {
      label: "Early (still somewhat calm)",
      items: uniqueStrings([
        ...takeMatching(hardTimeRecords, isEarlySupportItem).map(simplifyHardTimeItem).filter(Boolean),
        ...collectEarlyHardTimeItems(allItems)
      ])
    },
    {
      label: "Escalating / Very upset",
      items: dedupeHardTimeItems([
        ...takeMatching(
          hardTimeRecords,
          (item) => !isEarlySupportItem(item) && !isResetSupportItem(item)
        )
          .map(simplifyHardTimeItem)
          .filter(Boolean),
        ...collectEscalatedHardTimeItems(allItems)
      ])
    },
    {
      label: "Best resets",
      items: uniqueStrings([
        ...takeMatching(hardTimeRecords, isResetSupportItem).map(simplifyHardTimeItem).filter(Boolean),
        ...collectResetItems(allItems)
      ])
    }
  ]);

  const dailyNeedsSection = buildGroupedSection("Daily Needs to Know (High Value Only)", [
    {
      label: "Bathroom",
      items: uniqueStrings([
        ...takeMatching(dailyRecords, (item) => /\b(bathroom|toilet|pull-?up|grunting|bowel)\b/i.test(item)).map(
          simplifyDailyNeedItem
        ).filter(Boolean),
        ...takeMatching(signRecords, (item) => /\b(hiding|grunting|bowel)\b/i.test(item))
          .map(simplifyDailyNeedItem)
          .filter(Boolean),
        ...collectBathroomItems(allItems)
      ])
    },
    {
      label: "Eating",
      items: uniqueStrings([
        ...takeMatching(
          dailyRecords,
          (item) => /\b(food|eat|cheese|diet|meals?|drinking|water)\b/i.test(item)
        )
          .map(simplifyDailyNeedItem)
          .filter(Boolean),
        ...collectEatingItems(allItems)
      ])
    },
    {
      label: "Routine",
      items: takeMatching(dailyRecords, (item) => /\b(routine|morning|school|transition)\b/i.test(item)).map(
        simplifyDailyNeedItem
      ).filter(Boolean)
    }
  ]);

  const medicationItems = uniqueStrings([
    ...takeMatching(healthRecords, isMedicationItem).map(simplifyMedicationItem),
    ...collectMedicationItems(allItems)
  ]);
  const equipmentItems = uniqueStrings(
    [
      ...takeMatching(healthRecords, isEquipmentItem).map(simplifyEquipmentItem),
      ...communicationRecords
        .map((record) => record.text)
        .filter((item) => /\b(aac|touchchat|ipad)\b/i.test(item))
        .map(simplifyEquipmentItem),
      ...collectEquipmentItems(allItems)
    ].filter(Boolean)
  );
  const conditionItems = takeMatching(
    healthRecords,
    (item) => isHealthConditionItem(item) && !/\bpica\b/i.test(item)
  );
  const safetyItems = uniqueStrings([
    ...takeMatching(healthRecords, () => true).map(simplifySafetyItem).filter(Boolean),
    ...conditionItems
      .filter((item) => /\bpica\b/i.test(item))
      .map(simplifySafetyItem),
    ...collectSafetyItems(allItems)
  ]);

  const contactsSection = buildBulletsSection("Contacts", contactItems);
  const safetySection = buildBulletsSection("Safety Notes (CRITICAL SECTION)", safetyItems);
  const medicationsSection = buildBulletsSection("Medications (Simplified)", medicationItems);
  const equipmentSection = buildBulletsSection("Equipment / Supports", equipmentItems);
  const healthConditionsSection = buildBulletsSection(
    "Health Conditions",
    uniqueStrings([...conditionItems.map(simplifyConditionItem), ...collectConditionItems(allItems)])
  );
  const enjoymentSection = buildBulletsSection(
    titleSet.enjoyment,
    dedupeEnjoymentItems([
      ...allItems.map(simplifyEnjoymentItem).filter(Boolean),
      ...collectEnjoymentItems(allItems)
    ])
  );

  const structuredSections = [
    quickOverview,
    communicationSection,
    dayGoWellSection,
    triggerSection,
    signsSection,
    hardTimeSection,
    dailyNeedsSection,
    safetySection,
    medicationsSection,
    equipmentSection,
    healthConditionsSection,
    contactsSection,
    enjoymentSection
  ].filter((section): section is SummarySection => Boolean(section));

  return {
    ...EMPTY_SUMMARY,
    title: summaryTitle,
    overview: "",
    sections: structuredSections,
    generatedAt: legacySummary.generatedAt,
    pipelineVersion: SUMMARY_PIPELINE_VERSION,
    layoutVersion: SUMMARY_LAYOUT_VERSION,
    sourceTurnsHash: computeTurnsHash(turns)
  };
}
