import { ReflectionPrompt, StructuredSummary } from "@/lib/types";

export const APP_NAME = "Caregiver Handoff";

export const REFLECTION_PROMPTS: ReflectionPrompt[] = [
  {
    id: "day-goes-well-communication",
    sectionId: "what_helps_the_day_go_well",
    sectionTitle: "What helps the day go well",
    promptLabel: "Communication",
    question: "What should another caregiver know about communication so the day goes more smoothly?",
    examples: [
      "gestures, words, sounds, or a communication device",
      "whether they need extra time to respond",
      "anything that helps them understand or express needs"
    ]
  },
  {
    id: "day-goes-well-health-safety",
    sectionId: "what_helps_the_day_go_well",
    sectionTitle: "What helps the day go well",
    promptLabel: "Health & safety",
    question: "What health or safety information matters most for another caregiver to know?",
    examples: [
      "allergies, medical conditions, or medications",
      "equipment such as hearing aids, glasses, wheelchair, or feeding tube",
      "anything another caregiver must do correctly to keep them safe"
    ]
  },
  {
    id: "day-goes-well-daily-schedule",
    sectionId: "what_helps_the_day_go_well",
    sectionTitle: "What helps the day go well",
    promptLabel: "Daily schedule",
    question: "What routines, transitions, meals, or daily activities help the day stay on track?",
    examples: [
      "morning or bedtime routines",
      "meal and snack timing",
      "transition supports like countdowns or visual schedules"
    ]
  },
  {
    id: "day-goes-well-activities",
    sectionId: "what_helps_the_day_go_well",
    sectionTitle: "What helps the day go well",
    promptLabel: "Activities & preferences",
    question: "What activities, outings, people, or quiet-time preferences usually help things go well?",
    examples: [
      "favorite activities, videos, music, crafts, or walks",
      "trusted people they do well with",
      "rest, low-light, or sensory-space preferences"
    ]
  }
];

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
