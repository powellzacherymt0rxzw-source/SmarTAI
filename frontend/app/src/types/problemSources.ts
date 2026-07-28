import type { TaskMutationResponse } from "./task";

export type ProblemSourceMode = "upload" | "library" | "inline_text";
export type ProblemSourceScope = "course" | "all";
export type ProblemStructureMode = "organized" | "extract_from_source";
export type PreparationSourceRole = "problem" | "reference_answer" | "rubric" | "programming_tests";

export interface ProblemLibraryMaterial {
  material_id: string;
  filename: string;
  course_id?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  created_at?: number | null;
}

export interface ProblemLibraryResponse {
  items: ProblemLibraryMaterial[];
  total: number;
  scope: ProblemSourceScope;
}

export interface ProblemSourceCandidate {
  candidate_id: string;
  question_number?: string | null;
  preview?: string | null;
  line_number?: number | null;
  match_kind?: string | null;
  reason?: string | null;
}

export interface ProblemCandidateSummary {
  matched: ProblemSourceCandidate[];
  possible_matches: ProblemSourceCandidate[];
  not_found: string[];
  semantic_match_performed: boolean;
  notice?: string | null;
}

export interface ProblemSourceDescriptor {
  kind: ProblemSourceMode | string;
  filename: string;
  size_bytes: number;
  sha256: string;
  library_material_id?: string | null;
}

export interface ProblemSourcePreflightResponse {
  status: "ready" | string;
  source_token: string;
  source: ProblemSourceDescriptor | string;
  role?: PreparationSourceRole;
  structure_mode: ProblemStructureMode;
  requires_confirmation: boolean;
  candidate_summary: ProblemCandidateSummary;
  base_workflow_revision?: number;
  workflow_revision?: number;
}

export interface ProblemSourcePreflightInput {
  taskId: string;
  mode: ProblemSourceMode;
  role?: PreparationSourceRole;
  file?: File | null;
  libraryMaterialId?: string | null;
  inlineText?: string;
  structureMode: ProblemStructureMode;
  extractionHint?: string;
  saveToLibrary: boolean;
}

export interface StartProblemExtractionInput {
  taskId: string;
  sourceToken: string;
  confirmedCandidateIds?: string[];
  replaceConfirmed?: boolean;
}

export type StartProblemExtractionResponse = TaskMutationResponse;

export interface StartQuestionPreparationInput {
  taskId: string;
  sourceTokens: string[];
  expectedWorkflowRevision: number;
  replaceConfirmed?: boolean;
}

export type StartQuestionPreparationResponse = TaskMutationResponse & {
  source_count?: number;
};
