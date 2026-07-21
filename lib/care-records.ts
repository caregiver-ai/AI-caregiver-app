export const CARE_RECORD_CATEGORY_DEFINITIONS = [
  {
    id: "important_people",
    title: "Important People",
    description: "Caregivers, family, guardians, emergency contacts, neighbors, and friends."
  },
  {
    id: "health_insurance",
    title: "Health Care & Insurance",
    description: "Doctors, dentists, therapists, insurance, medications, pharmacy, and equipment."
  },
  {
    id: "legal_decision_making",
    title: "Legal Decision-Making",
    description: "Guardianship, health care proxy, power of attorney, representative payee, and trusts."
  },
  {
    id: "support_government",
    title: "Support & Government Services",
    description: "Case managers, DDS, Medicaid, MassHealth, SSI, SNAP, programs, transportation, and respite."
  },
  {
    id: "financial_advisors",
    title: "Financial Resources & Advisors",
    description: "ABLE accounts, bank accounts, benefits, insurance, attorneys, planners, and accountants."
  }
] as const;

export const CARE_RECORD_CATEGORY_IDS = CARE_RECORD_CATEGORY_DEFINITIONS.map(
  (category) => category.id
);

export type CareRecordCategory = (typeof CARE_RECORD_CATEGORY_DEFINITIONS)[number]["id"];
export type CareRecordSourceType = "typed" | "image" | "pdf";

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

export function normalizeCareRecordItemInput(input: CareRecordItemInput): Omit<CareRecordSuggestion, "tempId"> {
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

      if (normalized.fields.length === 0 && !normalized.notes) {
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

  if (/\b(doctor|dentist|therapist|hospital|pharmacy|medication|insurance|medicaid|masshealth)\b/.test(normalized)) {
    return "health_insurance";
  }

  if (/\b(guardian|guardianship|proxy|power of attorney|representative payee|trustee|legal)\b/.test(normalized)) {
    return "legal_decision_making";
  }

  if (/\b(dds|ssi|ssdi|snap|benefit|transportation|case manager|day program|respite|agency)\b/.test(normalized)) {
    return "support_government";
  }

  if (/\b(bank|able|trust|account|life insurance|financial|attorney|planner|accountant|tax)\b/.test(normalized)) {
    return "financial_advisors";
  }

  return "important_people";
}
