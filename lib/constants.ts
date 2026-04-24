import { StructuredSummary } from "@/lib/types";

export const APP_NAME = "Caregiver Handoff";

export const EMPTY_SUMMARY: StructuredSummary = {
  title: "",
  overview: "",
  sections: [],
  generatedAt: "",
  pipelineVersion: "",
  layoutVersion: "",
  sourceTurnsHash: ""
};

export const STORAGE_KEY = "caregiver-reflection-draft";
