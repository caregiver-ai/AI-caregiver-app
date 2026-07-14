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

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeAuditText(value: string) {
  return value
    .replace(/^\s*[A-Za-z][A-Za-z0-9 &'’/,-]{1,60}:\s+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function auditTokens(value: string) {
  const stopwords = new Set([
    "are",
    "best",
    "bowel",
    "during",
    "gavin",
    "having",
    "help",
    "helps",
    "may",
    "movement",
    "need",
    "needs",
    "reset",
    "sign",
    "that",
    "they",
    "when",
    "work",
    "works"
  ]);

  return normalizeAuditText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !stopwords.has(token));
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
  if (/^(?:also|and|but)\b/i.test(item)) {
    return true;
  }

  if (/^(?:he|she|they)\s+also\s+(?:likes?|loves?|enjoys?)\b/i.test(item)) {
    return true;
  }

  if (
    sectionTitle === "Activities & Preferences" &&
    /\b(favorite person|spending time with family|downtime|watch tv|watch television|left alone to do (?:his|her|their) own thing)\b/i.test(
      item
    )
  ) {
    return true;
  }

  return false;
}

function hasTerminalSentencePunctuation(value: string) {
  return /[.!?][)"'”’\]]*$/.test(compactWhitespace(value));
}

function hasUnbalancedQuotes(value: string) {
  const straightQuotes = value.match(/"/g)?.length ?? 0;
  const leftCurlyQuotes = value.match(/“/g)?.length ?? 0;
  const rightCurlyQuotes = value.match(/”/g)?.length ?? 0;

  return straightQuotes % 2 !== 0 || leftCurlyQuotes !== rightCurlyQuotes;
}

function itemLooksIncompleteOrMalformed(item: string) {
  const text = compactWhitespace(item);
  if (!text || !isMeaningfulItem(text)) {
    return false;
  }

  const withoutTerminalPunctuation = text.replace(/[.!?][)"'”’\]]*$/, "").trim();
  const allowedTerminalToPhrase =
    /\b(?:expects?|wants?|likes?|supposed) (?:it|things?|them|him|her) to$/i.test(withoutTerminalPunctuation) ||
    /\bresponds? appropriately when (?:he|she|they) wants? to$/i.test(withoutTerminalPunctuation) ||
    /\bwho (?:he|she|they) likes? to be with$/i.test(withoutTerminalPunctuation) ||
    /\bwho (?:he|she|they) spends? time with$/i.test(withoutTerminalPunctuation) ||
    /\brecognize and respond to$/i.test(withoutTerminalPunctuation) ||
    /\ballergic to$/i.test(withoutTerminalPunctuation) ||
    /\bstarts? (?:his|her|their) day with$/i.test(withoutTerminalPunctuation) ||
    /\beven if (?:he|she|they) wants? to$/i.test(withoutTerminalPunctuation) ||
    /\bwake up with$/i.test(withoutTerminalPunctuation) ||
    /\blook forward to$/i.test(withoutTerminalPunctuation) ||
    /\bused to$/i.test(withoutTerminalPunctuation);

  return (
    !hasTerminalSentencePunctuation(text) ||
    /[.!?]{2,}/.test(text) ||
    /\b(?:may mean|could|would) or if\b/i.test(text) ||
    /\bavoiding or caregivers should avoid\b/i.test(text) ||
    /\bmay also or when\b/i.test(text) ||
    /\bshows or (?:he|she|they) is\b/i.test(text) ||
    /\bas a usual or\b/i.test(text) ||
    /\bor or\b/i.test(text) ||
    /\bwhen [A-Z][a-z]+ is or\b/.test(text) ||
    (
      /\b(?:and|or|but|because|including|such as|with|to|if|when)$/i.test(withoutTerminalPunctuation) &&
      !allowedTerminalToPhrase
    ) ||
    /[:,;]$/.test(text) ||
    /\b(?:a|p)\.$/i.test(text) ||
    hasUnbalancedQuotes(text)
  );
}

export function itemIsAllowedInCurrentSection(item: string, title: string) {
  if (/^[A-Z][A-Za-z0-9 &'’/,-]{1,80}:\s+\S/.test(item)) {
    return true;
  }

  if (title === "Communication") {
    return /\b(communicat\w*|spoken|non-speaking|aac|touchchat|device|ipad|gesture|body language|body and face signs|body comfort|too hot|too cold|non[- ]?verbal|sounds?|voice|lead|touch|sit(?:s|ting)? close|attention|asks?|asked|answers?|answering|responds?|statements?|avoidant|questions?|yes or no|conversation|casual|careful|organically|choice-making|offer choices?|desires?|priorities|caregiver.?s idea|problem-solving|task follow-up|done something|missing items?|avoid or ignore|language|processing|literal|extra time|request\w*|select\w*|label\w*|express\w*|speak\w*|repeat|slow down|louder|understand\w*|pain|tired|story|exciting|positive)\b/i.test(item);
  }

  if (title === "Understanding and Learning") {
    return /\b(learn\w*|understand\w*|visual\w*|pictures?|choices?|first[ -]?then|two-step|2-step|directions?|instructions?|prompts?|daily-care|wait|processing|model(?:ing)?|demonstrat\w*|watch(?:ing)?|observe|context clues?|repeat|read|reading|write|writing|decision|recognizes?|body language|body signals?|comfortable|uncomfortable|plans? in advance|write them out|ahead of time|elevate|blood pool|walk signal|antecedents?|environmental cues?|specific task|frustration|ipad)\b/i.test(item);
  }

  if (title === "Daily Routine") {
    return /\b(routine|schedule|morning|wake|school|work|van|bathroom|toilet|toileting|void|bowel|pull-?up|shower|dress\w*|hygiene|grooming|hair|teeth|socks|deodorant|sleep|overnight|supervision|hydration|constipation|blood pressure|falls?|falling|getting up safely|stir|laying down|bedroom|pacing|transition\w*|technology|phone|computer|focus|tasks?|finish|asked|weekend|family errands|simple activities|body comments|privacy|stomach feels different|nobody.?s business|skin|vulvar|vaginal|daily monitoring|planning ahead|plans? out|in advance|process what will happen|independence|transfers?|caregiver support)\b/i.test(item);
  }

  if (title === "Food and Meals") {
    return /\b(food|foods?|meal|meals?|snack|treats?|sweets?|cupcakes?|cake|frosting|candy|sprinkles|eat|eating|drinks?|drinking|diet|breakfast|lunch|dinner|appetite|cheese|fridge|pasta|bite-sized|grazes?|hungry|hunger|prep(?:are|ared|aration)|texture|ground|pureed|chok\w*|oatmeal|applesauce|taste|smell|allerg\w*|pea protein|nutrition)\b/i.test(item);
  }

  if (title === "Activities and Interests") {
    return /\b(activit\w*|interests?|enjoy\w*|likes?|loves?|favorite|preferred|downtime|technology|phone|computer|tablet|videos?|movies?|music|friend|family|mother|father|sister|brother|caretakers?|comfort|walk|car|horseback|sports?|exercise|wii u|writing|club|room|possessions?|collects?|story|exciting|positive|choice|grub street|creative writing)\b/i.test(item);
  }

  if (title === "What Can Upset or Overwhelm") {
    return /\b(upset|overwhelm\w*|trigger\w*|hard|bother|bothering|short responses?|coax information|what happened|what did not happen|how (?:he|she|they) is feeling|friends?|other people|unfamiliar|new places?|routine changes?|routine itself|not a major source of distress|routine changes do not usually bother|pretty easy|sensitive to changes|environment\b.{0,40}\barranged|lights?|shades?|expected positions?|routine-related details|routines? and responsibilities|responsibilit\w*|part of (?:her|his|their) day|matter in (?:her|his|their) day|dog\b.{0,40}\bpee|pet care|transportation|bus|train|walk|street-crossing|safety-critical|self-injury|hit (?:herself|himself|themself)|planned activity cannot happen|disappointment escalates|weather|temperature|heat|sun|shade|loud|crowd|bright|chaotic|rushed|hover|not understood|pressure|sensory|hungry|pain|tired|lethargic|low-energy|not feeling well|adult direction|agency|control|walk signal)\b/i.test(item);
  }

  if (title === "Signs They Need Help") {
    return /\b(signs?|signals?|needs? help|needs support|watch|body|pain|hurt|injur|illness|sick|tired|fatigue|low energy|low-energy|letharg\w*|not eating|not drinking|temperature|too hot|too cold|shiver|clammy|pacing|quiet|withdraw|agitat\w*|dysregulat\w*|distress|stress|overload|overwhelm\w*|space|relief|step away|disengag\w*|moving away|sit still|leave abruptly|attention|communication changes?|early clues?|starting to struggle|risk behaviors?|direct help requests?|drags? a chair|kitchen counter|offer help|eyes on|help me|bottle open|elop\w*|run away|hand biting|angry|yelling|frustrat\w*|gestures?|press(?:es|ing)? help|hiding|grunting|bowel|fridge|hungry|hunger|not aggressive|antecedent|behavior changes?|baseline|usual presentation|notice when something is different|mobility|compromised leg|dental)\b/i.test(item);
  }

  if (title === "Health & Safety") {
    return /\b(health|safety|safe|risk|diagnos\w*|condition\w*|medical|medicat\w*|medicine|dose|allerg\w*|reaction|hives|supervision|emergency|contact|call|family|mother|father|sister|brother|equipment|buckle|seat ?belt|wheelchair|cane|glasses|hearing|seizure|pica|autism|disability|delay|mutation|chromosome|doctor|thyroid|weight|blood pressure|hydration|constipation|pain|body cues?|internal cues?|check in|observe patterns|obvious signals|body signals?|body signs?|entire body|express|understand\w*|instructions?|speak to|assume (?:he|she|they) understands?|wait after giving|respectful communication|babyize|may bite you|caregiver|ground|pureed|chok\w*|footwear|adhesives?|sensitivity|prevent avoidable problems|vaginal|vulvar|skin|leg|swollen|vascular|circulation|elevate|dental|teeth|tooth|overnight|awake overnight)\b/i.test(item);
  }

  if (title !== "What Helps When They Are Having a Hard Time") {
    return false;
  }

  return /\b(recognize|early signs?|starting to have a hard time|aggravat|frustrat|angry|agitat|pacing|space|quiet|stimulation|touch|talk|comfort|hug|walk away|hover|rushed|transitions? harder|contact family|guidance|unsure|swing|sensory room|squeeze|deep breath|count(?:ing)? to 10|gumm|swedish fish|candy|ipad|internet|history|video|youtube|car ride|drive|reliable reset|documented safety steps|back seat|backseat|buckle buddy|seat ?belt|lock(?:ed)?|loosen|retract|safe|hand biting|bite the caregiver|may bite|dog|walk|music|timer|schedule|first[ -]?then|preferred|motivat|speak first|explain what is happening|seizure|recover|settled)\b/i.test(
    item
  );
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
    options.source === "generated" || options.source === "saved"
      ? normalizeAuthoritativeStructuredSummary(input, options.nameHint)
      : normalizeEditableStructuredSummary(input, options.nameHint);
  const issues: SummaryAuditIssue[] = [...(options.issues ?? [])];

  for (const section of summary.sections) {
    const title = section.title as (typeof PREFERRED_SUMMARY_SECTION_ORDER)[number];
    const meaningfulItems = section.items.filter(isMeaningfulItem);

    for (const item of meaningfulItems) {
      const authoritativeTitle = inferAuthoritativeSectionTitle(item, title);
      if (authoritativeTitle !== title && !itemIsAllowedInCurrentSection(item, title)) {
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

      if (itemLooksIncompleteOrMalformed(item)) {
        issues.push({
          code: "incomplete_sentence",
          message: `${title} contains an incomplete or malformed sentence: ${item}`,
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
