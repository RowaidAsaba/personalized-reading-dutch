import type { ReadingSession } from "../types";

interface BackendTextToken {
  text: string;
  type: "word" | "punctuation" | "space";
  status?: "new" | "learning" | "known" | null;
  word_id?: string | number | null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mapSessionResponse(data: Record<string, unknown>): ReadingSession {
  const content = String(data.content ?? "");
  const rawBlue = (data.blue_words as Array<Record<string, unknown>>) ?? [];
  const rawYellow = (data.yellow_words as Array<Record<string, unknown>>) ?? [];
  const wordTranslations = (data.word_translations as Record<string, string>) ?? {};

  function buildHighlights(rows: Array<Record<string, unknown>>, type: "unknown" | "learning") {
    const highlights: ReadingSession["highlights"] = [];
    for (const row of rows) {
      const word = String(row.word ?? "");
      if (!word) continue;
      const markerRegex = new RegExp(`\\[\\[${escapeRegExp(word)}\\]\\]`, "gi");
      let match: RegExpExecArray | null;
      let found = false;
      while ((match = markerRegex.exec(content)) !== null) {
        found = true;
        highlights.push({
          wordId: String(row.word_id ?? ""),
          dutch: word,
          english: String(row.translation ?? ""),
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          highlightType: type,
          exampleSentences: Array.isArray(row.examples)
            ? (row.examples as Array<{ nl: string; en: string }>)
            : [],
          usageFrequency: "common",
        });
      }
      if (!found) {
        // Target word that the model did not bracket: still make it clickable by id.
        highlights.push({
          wordId: String(row.word_id ?? ""),
          dutch: word,
          english: String(row.translation ?? ""),
          startIndex: -1,
          endIndex: -1,
          highlightType: type,
          exampleSentences: Array.isArray(row.examples)
            ? (row.examples as Array<{ nl: string; en: string }>)
            : [],
          usageFrequency: "common",
        });
      }
    }
    return highlights;
  }

  return {
    sessionId: String(data.session_id ?? ""),
    title: String(data.title ?? ""),
    rawText: content,
    text: content.replace(/\[\[([^\]]+)\]\]/g, "$1"),
    tokens: ((data.tokens ?? []) as BackendTextToken[]).map((t) => ({
      text: String(t.text),
      type: t.type,
      status: t.status,
      wordId: t.word_id ? String(t.word_id) : null,
    })),
    topic: String(data.topic_used ?? ""),
    cefrLevel: String(data.cefr_level ?? "B1"),
    highlights: [
      ...buildHighlights(rawBlue, "unknown"),
      ...buildHighlights(rawYellow, "learning"),
    ],
    readingNumber: Number(data.reading_number ?? 1),
    ended: Boolean(data.ended),
    endedAt: typeof data.ended_at === "string" ? data.ended_at : null,
    continuationCount: Number(data.continuation_count ?? 0),
    wordTranslations,
  };
}
