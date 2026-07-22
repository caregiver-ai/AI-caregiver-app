export const CARE_RECORD_CATEGORY_DEFINITIONS = [
  {
    id: "living_situation",
    title: "Living Situation",
    description: "Home, housing, residence, landlord, household setup, and living arrangements."
  },
  {
    id: "important_people",
    title: "Important People",
    description: "Caregivers, family, guardians, emergency contacts, neighbors, and friends."
  },
  {
    id: "legal_decision_making",
    title: "Legal Decision Making",
    description: "Guardianship, health care proxy, power of attorney, representative payee, and trusts."
  },
  {
    id: "health_care",
    title: "Health Care",
    description: "Doctors, dentists, therapists, insurance, medications, pharmacy, equipment, and care providers."
  },
  {
    id: "support_services",
    title: "Support Services",
    description: "Case managers, day programs, respite, transportation, agencies, and service coordinators."
  },
  {
    id: "government_resources",
    title: "Government Resources",
    description: "DDS, Medicaid, MassHealth, SSI, SSDI, SNAP, public benefits, and government programs."
  },
  {
    id: "financial_resources",
    title: "Financial Resources",
    description: "ABLE accounts, bank accounts, trusts, benefits, life insurance, and financial assets."
  },
  {
    id: "professional_advisors",
    title: "Professional Advisors",
    description: "Attorneys, accountants, financial planners, tax preparers, and other advisors."
  },
  {
    id: "documents",
    title: "Documents",
    description: "Important paperwork, IDs, certificates, cards, forms, file locations, and document notes."
  }
] as const;

export const CARE_RECORD_CATEGORY_IDS = CARE_RECORD_CATEGORY_DEFINITIONS.map(
  (category) => category.id
);

export type CareRecordCategory = (typeof CARE_RECORD_CATEGORY_DEFINITIONS)[number]["id"];
export type LegacyCareRecordCategory =
  | "health_insurance"
  | "support_government"
  | "financial_advisors";
export type CareRecordSourceType = "typed" | "image" | "pdf";

export const LEGACY_CARE_RECORD_CATEGORY_MAP = {
  health_insurance: "health_care",
  support_government: "support_services",
  financial_advisors: "financial_resources"
} as const satisfies Record<LegacyCareRecordCategory, CareRecordCategory>;

export interface CareRecordField {
  label: string;
  value: string;
}

export interface CareRecordSuggestion {
  tempId: string;
  category: CareRecordCategory;
  title: string;
  fields: CareRecordField[];
  notes: string;
  sourceType: CareRecordSourceType;
  sourceLabel: string;
}

export interface CareRecordItem {
  id: string;
  workspaceId: string;
  category: CareRecordCategory;
  title: string;
  fields: CareRecordField[];
  notes: string;
  sourceType: CareRecordSourceType;
  sourceLabel: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CareRecordWorkspace {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CareRecordItemInput {
  category?: unknown;
  title?: unknown;
  fields?: unknown;
  notes?: unknown;
  sourceType?: unknown;
  sourceLabel?: unknown;
}

export type NormalizedCareRecordItemInput = Omit<CareRecordSuggestion, "tempId">;

const DEFAULT_CATEGORY: CareRecordCategory = "important_people";
const MAX_TITLE_LENGTH = 120;
const MAX_FIELD_LENGTH = 180;
const MAX_NOTES_LENGTH = 700;
const MAX_FIELDS = 8;

export const CARE_RECORD_EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: {
            type: "string",
            enum: CARE_RECORD_CATEGORY_IDS
          },
          title: {
            type: "string"
          },
          fields: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                label: {
                  type: "string"
                },
                value: {
                  type: "string"
                }
              },
              required: ["label", "value"]
            }
          },
          notes: {
            type: "string"
          }
        },
        required: ["category", "title", "fields", "notes"]
      }
    }
  },
  required: ["items"]
} as const;

export function getCareRecordCategoryTitle(category: CareRecordCategory) {
  return (
    CARE_RECORD_CATEGORY_DEFINITIONS.find((entry) => entry.id === category)?.title ??
    CARE_RECORD_CATEGORY_DEFINITIONS[0].title
  );
}

export function normalizeCareRecordCategory(value: unknown): CareRecordCategory {
  if (typeof value !== "string") {
    return DEFAULT_CATEGORY;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized in LEGACY_CARE_RECORD_CATEGORY_MAP) {
    return LEGACY_CARE_RECORD_CATEGORY_MAP[normalized as LegacyCareRecordCategory];
  }

  return CARE_RECORD_CATEGORY_IDS.includes(normalized as CareRecordCategory)
    ? (normalized as CareRecordCategory)
    : DEFAULT_CATEGORY;
}

export function normalizeCareRecordSourceType(value: unknown): CareRecordSourceType {
  if (value === "image" || value === "pdf") {
    return value;
  }

  return "typed";
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  const compacted = compactWhitespace(value);
  return compacted.length <= maxLength ? compacted : `${compacted.slice(0, maxLength - 3)}...`;
}

export function normalizeCareRecordFields(input: unknown): CareRecordField[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const fields: CareRecordField[] = [];

  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as { label?: unknown; value?: unknown };
    const label = typeof candidate.label === "string" ? truncate(candidate.label, MAX_FIELD_LENGTH) : "";
    const value = typeof candidate.value === "string" ? truncate(candidate.value, MAX_FIELD_LENGTH) : "";

    if (!label || !value) {
      continue;
    }

    fields.push({ label, value });

    if (fields.length >= MAX_FIELDS) {
      break;
    }
  }

  return fields;
}

export function normalizeCareRecordItemInput(input: CareRecordItemInput): NormalizedCareRecordItemInput {
  const title =
    typeof input.title === "string" && input.title.trim()
      ? truncate(input.title, MAX_TITLE_LENGTH)
      : "Care record";
  const notes = typeof input.notes === "string" ? truncate(input.notes, MAX_NOTES_LENGTH) : "";
  const sourceLabel =
    typeof input.sourceLabel === "string" && input.sourceLabel.trim()
      ? truncate(input.sourceLabel, MAX_TITLE_LENGTH)
      : "Caregiver entry";

  return {
    category: normalizeCareRecordCategory(input.category),
    title,
    fields: normalizeCareRecordFields(input.fields),
    notes,
    sourceType: normalizeCareRecordSourceType(input.sourceType),
    sourceLabel
  };
}

export function hasCareRecordContent(record: Pick<NormalizedCareRecordItemInput, "fields" | "notes">) {
  return (
    record.notes.trim().length > 0 ||
    record.fields.some((field) => field.label.trim() && field.value.trim())
  );
}

export function normalizeApprovedCareRecordInputs(
  inputs: CareRecordItemInput[]
): NormalizedCareRecordItemInput[] {
  return inputs.map((item) => normalizeCareRecordItemInput(item)).filter(hasCareRecordContent);
}

export function normalizeCareRecordSuggestions(
  input: unknown,
  sourceType: CareRecordSourceType,
  sourceLabel: string
): CareRecordSuggestion[] {
  const sourceItems =
    input && typeof input === "object" && Array.isArray((input as { items?: unknown }).items)
      ? (input as { items: unknown[] }).items
      : [];

  return sourceItems
    .map((item, index) => {
      const normalized = normalizeCareRecordItemInput({
        ...(item && typeof item === "object" ? (item as Record<string, unknown>) : {}),
        sourceType,
        sourceLabel
      });

      if (!hasCareRecordContent(normalized)) {
        return null;
      }

      return {
        tempId: `suggestion-${Date.now()}-${index}`,
        ...normalized
      };
    })
    .filter((item): item is CareRecordSuggestion => Boolean(item));
}

export function groupCareRecordItemsByCategory<T extends { category: CareRecordCategory }>(items: T[]) {
  return CARE_RECORD_CATEGORY_DEFINITIONS.map((category) => ({
    ...category,
    items: items.filter((item) => item.category === category.id)
  }));
}

export function parseCareRecordExtractionText(value: string) {
  const trimmed = value.trim();
  const jsonText = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(jsonText) as { items?: unknown[] };
}

export function buildFallbackCareRecordSuggestions(text: string): CareRecordSuggestion[] {
  const compacted = compactWhitespace(text);
  if (!compacted) {
    return [];
  }

  const category = inferCareRecordCategory(compacted);
  return [
    {
      tempId: `suggestion-${Date.now()}-fallback`,
      category,
      title: getCareRecordCategoryTitle(category),
      fields: [{ label: "Information", value: truncate(compacted, MAX_FIELD_LENGTH) }],
      notes: compacted.length > MAX_FIELD_LENGTH ? truncate(compacted, MAX_NOTES_LENGTH) : "",
      sourceType: "typed",
      sourceLabel: "Typed entry"
    }
  ];
}

export function inferCareRecordCategory(value: string): CareRecordCategory {
  const normalized = value.toLowerCase();

  if (/\b(attorney|lawyer|accountant|financial planner|advisor|tax preparer|cpa)\b/.test(normalized)) {
    return "professional_advisors";
  }

  if (/\b(document|paperwork|folder|file|form|certificate|birth certificate|social security card|passport|id card|license|card)\b/.test(normalized)) {
    return "documents";
  }

  if (/\b(doctor|dentist|therapist|hospital|pharmacy|medication|medicine|insurance|health plan|policy|equipment|clinic|nurse)\b/.test(normalized)) {
    return "health_care";
  }

  if (/\b(guardian|guardianship|proxy|power of attorney|representative payee|trustee|legal)\b/.test(normalized)) {
    return "legal_decision_making";
  }

  if (/\b(medicaid|masshealth|dds|ssi|ssdi|snap|public benefit|government|state agency)\b/.test(normalized)) {
    return "government_resources";
  }

  if (/\b(case manager|service coordinator|day program|respite|transportation|agency|support service|support staff)\b/.test(normalized)) {
    return "support_services";
  }

  if (/\b(bank|able|trust|account|life insurance|financial|benefit|asset|income|savings)\b/.test(normalized)) {
    return "financial_resources";
  }

  if (/\b(home|housing|address|apartment|residence|living situation|landlord|lease|roommate|household)\b/.test(normalized)) {
    return "living_situation";
  }

  return "important_people";
}
