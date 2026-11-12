export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export const CEFR_LEVELS: readonly CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export const PURPOSES = ["work", "study", "integration", "travel", "other"] as const;
export type Purpose = (typeof PURPOSES)[number];

export const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;
export type Gender = (typeof GENDERS)[number]["value"];

export interface User {
  id: string;
  email: string;
  name: string;
  display_name: string;
  interests: string[];
  cefrLevel: CefrLevel | null;
  effectiveCefr: CefrLevel | null;
  difficultyOffset: number;
  onboarding_completed: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
  createdAt: string | null;

  age?: number | null;
  city?: string | null;
  gender?: Gender | null;
  job?: string | null;
  academic_background?: string | null;
  mother_language?: string | null;
  other_languages?: string | null;
  purpose?: Purpose | null;
}

export interface ProfileUpdate {
  display_name?: string;
  age?: number;
  city?: string;
  gender?: Gender | "";
  job?: string;
  academic_background?: string;
  mother_language?: string;
  other_languages?: string;
  purpose?: string;
  interests?: string[];
  estimated_cefr?: string;
  difficulty_offset?: number;
}

export interface BilingualSentence {
  nl: string;
  en: string;
}

export interface LexiconEntry {
  word_id: number;
  word: string;
  translation: string;
  cefr_level: string;
  examples?: Array<BilingualSentence> | null;
  use_cases?: Array<BilingualSentence> | null;
}

export type HighlightType = "unknown" | "learning";

export interface HighlightedWord {
  wordId: string;
  dutch: string;
  english: string;
  startIndex: number;
  endIndex: number;
  highlightType: HighlightType;
  exampleSentences: BilingualSentence[];
  usageFrequency: "common" | "moderate" | "rare";
}

export interface TextToken {
  text: string;
  type: "word" | "punctuation" | "space";
  status?: "new" | "learning" | "known" | null;
  wordId?: string | null;
}

export interface ReadingSession {
  sessionId: string;
  text: string;
  rawText: string;
  tokens: TextToken[];
  title: string;
  topic: string;
  cefrLevel: string;
  highlights: HighlightedWord[];
  readingNumber: number;
  ended: boolean;
  endedAt: string | null;
  continuationCount: number;
  wordTranslations: Record<string, string>;
}

export interface SessionSummary {
  session_id: number;
  title: string;
  topic_used: string | null;
  reading_number: number;
  cefr_level: string | null;
  ended: boolean;
  ended_at: string | null;
  created_at: string | null;
  continuation_count: number;
}

export type Rating = 1 | 2 | 3 | 4 | 5;

export interface ReadingFeedback {
  difficulty: Rating;   // 1 too easy .. 3 normal .. 5 too difficult
  interest: Rating;
  relevance: Rating;
  worth_time: Rating;
}

export interface ReadingProductivity {
  session_name: string;
  duration_min: number;
  date: string | null;
}

export interface DashboardStats {
  cefr_level: string;
  effective_cefr: string | null;
  difficulty_offset: number;
  words_known_goal: number;
  acquisition_score: number;
  total_known: number;
  total_learning: number;
  total_mastered: number;
  to_review: number;
  reviewed_today: number;
  daily_progress: number;
  readings_completed: number;
  readings_total: number;
  productivity_data?: ReadingProductivity[];
  avg_duration_min?: number;
  time_today_min: number;
  time_week_min: number;
  time_month_min: number;
  is_new: boolean;
}

export type VocabStatus = "new" | "encountered" | "learning" | "mastered";

export interface FlashcardItem {
  wordId: string;
  dutch: string;
  english: string;
  cefrLevel?: string;
  examples: BilingualSentence[];
  exampleSentence: BilingualSentence;
  status: VocabStatus;
  masteryScore: number;
  nextReviewDate: string | null;
  reviewInterval: number | null;
  lookupCount: number;
}

export interface AssessmentWord {
  wordId: string;
  dutch: string;
  english?: string;
  isPseudo?: boolean;
}

export interface AssessmentBatchData {
  batchNumber: number;
  totalBatches: number;
  words: AssessmentWord[];
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };
