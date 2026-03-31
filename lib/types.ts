export type ReflectionSectionId = "what_helps_the_day_go_well";
export type UiLanguage = "english" | "spanish" | "mandarin";

export type TurnRole = "assistant" | "user";

export type PromptType = "section_prompt" | "system";

export interface ConversationTurn {
  id: string;
  role: TurnRole;
  promptType: PromptType;
  content: string;
  createdAt: string;
  sectionId?: ReflectionSectionId;
  sectionTitle?: string;
  promptLabel?: string;
  promptExamples?: string[];
  skipped?: boolean;
}

export interface StructuredSummary {
  key_barriers: string[];
  emotional_concerns: string[];
  safety_considerations: string[];
  past_negative_experiences: string[];
  situations_to_avoid: string[];
  conditions_for_successful_respite: string[];
  unresolved_questions: string[];
  caregiver_summary_text: string;
}

export interface SessionIntakeDetails {
  caregiverName: string;
  caregiverAge: string;
  caregiverPhone: string;
  careRecipientName: string;
  careRecipientAge: string;
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
