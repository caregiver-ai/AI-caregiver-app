export type ReflectionSectionId = "what_helps_the_day_go_well";
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
  promptLabel?: string;
  promptExamples?: string[];
  skipped?: boolean;
}

export interface SummarySection {
  id: string;
  title: string;
  items: string[];
}

export interface StructuredSummary {
  title: string;
  overview: string;
  sections: SummarySection[];
  generatedAt: string;
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
  feedback?: {
    usefulnessRating: string;
    comments: string;
  };
}

export interface ReflectionPrompt {
  id: string;
  sectionId: ReflectionSectionId;
  sectionTitle: string;
  promptLabel: string;
  question: string;
  examples: string[];
}
