import type { StructuredSummary } from "@/lib/types";

export const APP_NAME = "Caregiver AI";

export const EMPTY_SUMMARY: StructuredSummary = {
  title: "",
  overview: "",
  caregiverInsights: [],
  sections: [],
  generatedAt: "",
  pipelineVersion: "",
  layoutVersion: "",
  sourceTurnsHash: ""
};

export const STORAGE_KEY = "caregiver-reflection-draft";
