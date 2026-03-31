import { StructuredSummary } from "@/lib/types";

export const APP_NAME = "Caregiver Handoff";

export const EMPTY_SUMMARY: StructuredSummary = {
  key_barriers: [],
  emotional_concerns: [],
  safety_considerations: [],
  past_negative_experiences: [],
  situations_to_avoid: [],
  conditions_for_successful_respite: [],
  unresolved_questions: [],
  caregiver_summary_text: ""
};

export const STORAGE_KEY = "caregiver-reflection-draft";
