import { apiClient, extractError, readingGenerationTimeoutMs } from "./http";
import { mapSessionResponse } from "./sessionMapper";
import type {
  ApiResponse,
  AssessmentBatchData,
  FlashcardItem,
  LexiconEntry,
  ProfileUpdate,
  ReadingFeedback,
  ReadingSession,
  SessionSummary,
  User,
} from "../types";

export { apiClient } from "./http";

// ---------------------------------------------------------------- auth

interface BackendUser {
  id: string;
  email: string;
  display_name?: string | null;
  interests?: string[];
  estimated_cefr?: string | null;
  effective_cefr?: string | null;
  difficulty_offset?: number;
  onboarding_completed: boolean;
  has_password?: boolean;
  has_google?: boolean;
  age?: number | null;
  city?: string | null;
  gender?: string | null;
  job?: string | null;
  academic_background?: string | null;
  mother_language?: string | null;
  other_languages?: string | null;
  purpose?: string | null;
  created_at?: string | null;
}

interface BackendAuthResponse {
  access_token: string;
  token_type: string;
  user: BackendUser;
}

export interface AuthResult {
  user: User;
  token: string;
}

function mapUser(data: BackendUser): User {
  const displayName = data.display_name ?? "";
  return {
    id: data.id,
    email: data.email,
    name: displayName || data.email.split("@")[0],
    display_name: displayName,
    interests: Array.isArray(data.interests) ? data.interests : [],
    cefrLevel: (data.estimated_cefr as User["cefrLevel"]) ?? null,
    effectiveCefr: (data.effective_cefr as User["effectiveCefr"]) ?? null,
    difficultyOffset: data.difficulty_offset ?? 0,
    onboarding_completed: Boolean(data.onboarding_completed),
    hasPassword: Boolean(data.has_password),
    hasGoogle: Boolean(data.has_google),
    createdAt: data.created_at ?? null,
    age: data.age ?? null,
    city: data.city ?? null,
    gender: (data.gender as User["gender"]) ?? null,
    job: data.job ?? null,
    academic_background: data.academic_background ?? null,
    mother_language: data.mother_language ?? null,
    other_languages: data.other_languages ?? null,
    purpose: (data.purpose as User["purpose"]) ?? null,
  };
}

function mapAuth(data: BackendAuthResponse): AuthResult {
  return { user: mapUser(data.user), token: data.access_token };
}

export async function register(email: string, password: string, displayName?: string): Promise<AuthResult> {
  try {
    const { data } = await apiClient.post<BackendAuthResponse>("/auth/register", {
      email,
      password,
      display_name: displayName || undefined,
    });
    return mapAuth(data);
  } catch (err) {
    throw new Error(extractError(err));
  }
}

export async function login(email: string, password: string): Promise<AuthResult> {
  try {
    const { data } = await apiClient.post<BackendAuthResponse>("/auth/login", { email, password });
    return mapAuth(data);
  } catch (err) {
    throw new Error(extractError(err));
  }
}

export async function googleSignIn(credential: string): Promise<AuthResult> {
  try {
    const { data } = await apiClient.post<BackendAuthResponse>("/auth/google", { credential });
    return mapAuth(data);
  } catch (err) {
    throw new Error(extractError(err));
  }
}

export async function fetchMe(): Promise<User> {
  try {
    const { data } = await apiClient.get<BackendUser>("/users/me");
    return mapUser(data);
  } catch (err) {
    throw new Error(extractError(err));
  }
}

export async function saveProfile(update: ProfileUpdate): Promise<User> {
  try {
    const { data } = await apiClient.put<BackendUser>("/users/me/profile", update);
    return mapUser(data);
  } catch (err) {
    throw new Error(extractError(err));
  }
}

// ---------------------------------------------------------------- onboarding word check

interface BackendAssessmentWord {
  word_id: string | number;
  dutch: string;
  english?: string | null;
  is_pseudo?: boolean;
}

interface BackendAssessmentBatch {
  batch_number?: number;
  total_batches?: number;
  words?: BackendAssessmentWord[];
}

export async function getAssessmentBatch(
  batchNumber: number,
  selfReportedCefr: string,
  knownWords?: string[],
  allWords?: string[],
): Promise<ApiResponse<AssessmentBatchData>> {
  try {
    const { data } = await apiClient.post<BackendAssessmentBatch>("/assessment/batch/generate", {
      batch_number: batchNumber,
      self_reported_cefr: selfReportedCefr,
      known_words: knownWords ?? [],
      all_words: allWords ?? [],
    });
    return {
      success: true,
      data: {
        batchNumber: Number(data.batch_number ?? batchNumber),
        totalBatches: Number(data.total_batches ?? 1),
        words: (data.words || []).map((w) => ({
          wordId: String(w.word_id),
          dutch: String(w.dutch),
          english: typeof w.english === "string" ? w.english : undefined,
          isPseudo: Boolean(w.is_pseudo),
        })),
      },
    };
  } catch (err) {
    return { success: false, error: extractError(err) };
  }
}

export async function submitAssessment(
  batchNumber: number,
  knownWordIds: string[],
  allWordIds: string[],
  estimatedLevel: string,
  confidenceScore: number,
  isFinal: boolean,
): Promise<{ estimatedCefr: string | null }> {
  try {
    const { data } = await apiClient.post<{ estimated_cefr?: string | null }>("/assessment/submit", {
      batch_number: batchNumber,
      known_word_ids: knownWordIds,
      all_word_ids: allWordIds,
      estimated_level: estimatedLevel,
      confidence_score: confidenceScore,
      is_final: isFinal,
    });
    return { estimatedCefr: data.estimated_cefr ?? null };
  } catch (err) {
    throw new Error(extractError(err));
  }
}

// ---------------------------------------------------------------- readings

export async function generateSession(): Promise<ReadingSession> {
  try {
    const { data } = await apiClient.post<Record<string, unknown>>(
      "/session/generate",
      {},
      { timeout: readingGenerationTimeoutMs },
    );
    return mapSessionResponse(data);
  } catch (err) {
    throw new Error(extractError(err));
  }
}

export async function getReadingSession(sessionId: string): Promise<ApiResponse<ReadingSession>> {
  try {
    const { data } = await apiClient.get<Record<string, unknown>>(`/session/${sessionId}`);
    return { success: true, data: mapSessionResponse(data) };
  } catch (err) {
    return { success: false, error: extractError(err) };
  }
}

export async function listSessions(): Promise<SessionSummary[]> {
  try {
    const { data } = await apiClient.get<SessionSummary[]>("/session/list");
    return data;
  } catch {
    return [];
  }
}

export async function continueSession(sessionId: string): Promise<ReadingSession> {
  try {
    const { data } = await apiClient.post<Record<string, unknown>>(
      `/session/${sessionId}/continue`,
      {},
      { timeout: readingGenerationTimeoutMs },
    );
    return mapSessionResponse(data);
  } catch (err) {
    throw new Error(extractError(err));
  }
}

export async function endSession(
  sessionId: string,
  options: { durationSeconds?: number; feedback?: ReadingFeedback },
): Promise<ReadingSession> {
  try {
    const { data } = await apiClient.post<Record<string, unknown>>(`/session/${sessionId}/end`, {
      duration_seconds: options.durationSeconds,
      feedback: options.feedback,
    });
    return mapSessionResponse(data);
  } catch (err) {
    throw new Error(extractError(err));
  }
}

// ---------------------------------------------------------------- words

export async function defineWord(word: string): Promise<LexiconEntry | null> {
  try {
    const { data } = await apiClient.get<LexiconEntry>(`/lexicon/define/${encodeURIComponent(word)}`);
    return data;
  } catch {
    return null;
  }
}

export interface LookupResult {
  counted: boolean;
  status: "new" | "encountered" | "learning" | "mastered";
  demoted: boolean;
}

export async function lookupWord(wordId: string, sessionId?: string): Promise<LookupResult | null> {
  try {
    const { data } = await apiClient.post<LookupResult>("/vocab/lookup", {
      word_id: parseInt(wordId, 10),
      session_id: sessionId ? parseInt(sessionId, 10) : undefined,
    });
    return data;
  } catch {
    return null;
  }
}

export interface ReviewQueue {
  cards: FlashcardItem[];
  due_count: number;
  reviewed_today: number;
  learning_total: number;
}

function normalizeCard(card: Omit<FlashcardItem, "exampleSentence">): FlashcardItem {
  const examples = card.examples ?? [];
  return {
    ...card,
    examples,
    exampleSentence: examples[0] ?? { nl: card.dutch, en: card.english },
  };
}

export async function getReviewQueue(): Promise<ApiResponse<ReviewQueue>> {
  try {
    const { data } = await apiClient.get<ReviewQueue>("/vocab/review");
    return { success: true, data: { ...data, cards: (data.cards ?? []).map(normalizeCard) } };
  } catch (err) {
    return { success: false, error: extractError(err) };
  }
}

export async function getDiscoverWords(limit = 20): Promise<ApiResponse<{ words: FlashcardItem[]; remaining: number }>> {
  try {
    const { data } = await apiClient.get<{ words: FlashcardItem[]; remaining: number }>("/vocab/discover", {
      params: { limit },
      timeout: 90_000,
    });
    return {
      success: true,
      data: { words: (data.words ?? []).map(normalizeCard), remaining: data.remaining ?? 0 },
    };
  } catch (err) {
    return { success: false, error: extractError(err) };
  }
}

export async function submitReview(wordId: string, remembered: boolean, intervalDays?: number): Promise<void> {
  await apiClient.post("/vocab/review", {
    word_id: parseInt(wordId, 10),
    remembered,
    interval_days: intervalDays ?? null,
  });
}

export async function markKnown(wordId: string): Promise<void> {
  await apiClient.post("/vocab/mark-known", { word_id: parseInt(wordId, 10) });
}

export async function addToLearn(wordId: string, intervalDays = 1): Promise<void> {
  await apiClient.post("/vocab/add-to-learn", { word_id: parseInt(wordId, 10), interval_days: intervalDays });
}

export function isBackendNotReadyMessage(msg: string): boolean {
  return msg.includes("backend") || msg.includes("503") || msg.includes("502") || msg.includes("not configured");
}
