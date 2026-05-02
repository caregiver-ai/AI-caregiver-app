export type ReflectionSectionId =
  | "what_helps_the_day_go_well"
  | "what_can_upset_or_overwhelm_them"
  | "signs_they_may_need_help"
  | "what_helps_when_they_are_having_a_hard_time"
  | "who_to_contact_and_when";
export type ReflectionStepId =
  | "communication"
  | "health_safety"
  | "daily_schedule"
  | "activities_preferences"
  | "upset_overwhelm"
  | "signs_need_help"
  | "hard_time_support"
  | "who_to_contact";
export type UiLanguage = "english" | "spanish" | "mandarin";
export type YesNoOption = "" | "yes" | "no";

export type TurnRole = "assistant" | "user";

export type PromptType = "section_prompt" | "system";

export interface ConversationTurn {
  id: string;
  role: TurnRole;
  promptType: PromptType;
  content: string;
  createdAt: string;
  promptId?: string;
  sectionId?: ReflectionSectionId;
  sectionTitle?: string;
  stepId?: ReflectionStepId;
  stepTitle?: string;
  stepSubtitle?: string;
  stepCompletionMessage?: string;
  promptLabel?: string;
  promptExamples?: string[];
  skipped?: boolean;
}

export interface SummarySection {
  id: string;
  title: string;
  intro?: string;
  items: string[];
  blocks?: SummaryBlock[];
}

export interface SummaryKeyValueRow {
  label: string;
  value: string;
}

export interface SummaryLabeledGroup {
  label: string;
  items: string[];
}

export type SummaryBlock =
  | {
      type: "bullets";
      items: string[];
    }
  | {
      type: "labeledBullets";
      groups: SummaryLabeledGroup[];
    }
  | {
      type: "keyValue";
      rows: SummaryKeyValueRow[];
    }
  | {
      type: "note";
      text: string;
    };

export interface StructuredSummary {
  title: string;
  overview: string;
  sections: SummarySection[];
  generatedAt: string;
  pipelineVersion: string;
  layoutVersion: string;
  sourceTurnsHash: string;
}

export type SummaryAuditStatus = "pass" | "warn";
export type SummaryAuditSeverity = "hard" | "soft";
export type SummaryAuditVisibility = "user" | "internal";

export interface SummaryAuditIssue {
  code:
    | "missing_coverage"
    | "section_leakage"
    | "wrong_section"
    | "duplicate_item"
    | "awkward_item";
  message: string;
  severity?: SummaryAuditSeverity;
  visibility?: SummaryAuditVisibility;
  userMessage?: string;
  factId?: string;
  expectedSection?: string;
  actualSection?: string;
  sectionTitle?: string;
  item?: string;
}

export interface SummaryAuditSectionWarning {
  sectionTitle: string;
  count: number;
}

export interface SummaryAuditReport {
  status: SummaryAuditStatus;
  userStatus: SummaryAuditStatus;
  issues: SummaryAuditIssue[];
  userVisibleIssues: SummaryAuditIssue[];
  diagnostics: string[];
  sectionWarnings: SummaryAuditSectionWarning[];
  userSectionWarnings: SummaryAuditSectionWarning[];
}

export interface SummaryArchive {
  structuredSummary?: StructuredSummary;
  editedSummary?: StructuredSummary;
  archivedAt: string;
  reason: "stale_regeneration";
}

export interface SummaryFreshness {
  generated: "fresh" | "stale" | "missing";
  edited: "fresh" | "stale" | "missing";
  requiresRegeneration: boolean;
}

export interface SessionIntakeDetails {
  caregiverFirstName: string;
  caregiverLastName: string;
  caregiver55OrOlder: YesNoOption;
  caregiverPhone: string;
  careRecipientFirstName: string;
  careRecipientLastName: string;
  careRecipientPreferredName: string;
  careRecipientDateOfBirth: string;
  preferredLanguage: UiLanguage;
}

export interface SessionDraft {
  sessionId: string;
  email: string;
  consented: boolean;
  intakeDetails: SessionIntakeDetails;
  turns: ConversationTurn[];
  structuredSummary?: StructuredSummary;
  editedSummary?: StructuredSummary;
  structuredSummaryAudit?: SummaryAuditReport;
  editedSummaryAudit?: SummaryAuditReport;
  summaryArchives?: SummaryArchive[];
  feedback?: {
    usefulnessRating: string;
    comments: string;
  };
}

export interface ReflectionPrompt {
  id: string;
  sectionId: ReflectionSectionId;
  sectionTitle: string;
  stepId: ReflectionStepId;
  stepTitle: string;
  stepSubtitle: string;
  stepCompletionMessage: string;
  promptLabel: string;
  question: string;
  examples: string[];
}
