import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, Check, Home, Hourglass, Layers, RefreshCw, RotateCcw, Sparkles } from "lucide-react";

import { useStore } from "../store";
import {
  addToLearn,
  getDiscoverWords,
  getReviewQueue,
  markKnown,
  submitReview,
  type ReviewQueue,
} from "../services/api";
import type { FlashcardItem } from "../types";
import SpeakButton from "../components/SpeakButton";
import ErrorBanner from "../components/ErrorBanner";

type Mode = "review" | "discover";
const DISCOVER_BATCH = 20;
const DISCOVER_LOW_WATER = 5;

export default function FlashcardsPage() {
  const navigate = useNavigate();
  const user = useStore((s) => s.user);
  const userId = user?.id;

  const [mode, setMode] = useState<Mode>("review");

  const [reviewData, setReviewData] = useState<ReviewQueue | null>(null);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);

  const [discoverCards, setDiscoverCards] = useState<FlashcardItem[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverLoaded, setDiscoverLoaded] = useState(false);
  const decidedIds = useRef<Set<string>>(new Set());
  const fetching = useRef(false);

  const fetchReview = useCallback(() => {
    if (!userId) return;
    setReviewLoading(true);
    getReviewQueue()
      .then((res) => {
        if (res.success) setReviewData(res.data);
        else setReviewError(res.error ?? "Could not load word review.");
      })
      .catch(() => setReviewError("Unexpected error."))
      .finally(() => setReviewLoading(false));
  }, [userId]);

  const fetchDiscover = useCallback(async () => {
    if (!userId || fetching.current) return;
    fetching.current = true;
    setDiscoverLoading(true);
    setDiscoverError(null);
    try {
      const res = await getDiscoverWords(DISCOVER_BATCH);
      if (!res.success) {
        setDiscoverError(res.error);
        return;
      }
      setDiscoverCards((prev) => {
        const seen = new Set(prev.map((c) => c.wordId));
        const fresh = res.data.words.filter((w) => !seen.has(w.wordId) && !decidedIds.current.has(w.wordId));
        return [...prev, ...fresh];
      });
    } finally {
      fetching.current = false;
      setDiscoverLoading(false);
      setDiscoverLoaded(true);
    }
  }, [userId]);

  useEffect(() => {
    fetchReview();
  }, [fetchReview]);

  useEffect(() => {
    void fetchDiscover();
  }, [fetchDiscover]);

  useEffect(() => {
    if (mode === "discover" && discoverLoaded && discoverCards.length < DISCOVER_LOW_WATER && !discoverLoading) {
      void fetchDiscover();
    }
  }, [mode, discoverCards.length, discoverLoaded, discoverLoading, fetchDiscover]);

  if (!user) return null;

  const dueTotal = reviewData?.due_count ?? 0;
  const dueRemaining = Math.max(0, dueTotal - reviewedCount);

  function handleDiscoverDone(wordId: string) {
    decidedIds.current.add(wordId);
    setDiscoverCards((prev) => prev.filter((c) => c.wordId !== wordId));
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-2xl border border-black/8 bg-white px-5 py-4 shadow-sm shadow-black/5 mb-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Layers size={18} />
            </div>
            <div>
              <h1 className="font-heading text-xl font-bold text-text">Flashcards</h1>
              <p className="text-xs font-body text-text/50">
                {mode === "review"
                  ? dueTotal === 0 ? "No words due" : `${dueRemaining} due · ${reviewedCount} reviewed`
                  : discoverLoading && discoverCards.length === 0
                    ? "Finding new words for you…"
                    : `${discoverCards.length} new words ready`}
              </p>
            </div>
          </div>

          <div className="flex rounded-xl border border-black/10 bg-black/[0.02] p-1 gap-1">
            {(["review", "discover"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={[
                  "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-heading font-semibold transition-all",
                  mode === m
                    ? "bg-white shadow text-primary border border-black/8"
                    : "text-text/50 hover:text-text",
                ].join(" ")}
              >
                {m === "review" ? <RotateCcw size={13} /> : <Sparkles size={13} />}
                {m === "review"
                  ? <>Review {dueTotal > 0 && <span className="ml-1 rounded-full bg-red-500 text-white text-[10px] px-1.5 py-0.5">{dueRemaining}</span>}</>
                  : <>Discover {discoverCards.length > 0 && <span className="ml-1 rounded-full bg-violet-100 text-violet-600 text-[10px] px-1.5 py-0.5">{discoverCards.length}</span>}</>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {mode === "review" ? (
          <motion.div key="review" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <ReviewMode
              loading={reviewLoading}
              error={reviewError}
              data={reviewData}
              onHome={() => navigate("/home")}
              onReviewedChange={setReviewedCount}
              onDiscover={() => setMode("discover")}
            />
          </motion.div>
        ) : (
          <motion.div key="discover" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <DiscoverMode
              cards={discoverCards}
              loading={discoverLoading}
              error={discoverError}
              onCardDone={handleDiscoverDone}
              onRefreshReview={fetchReview}
              onRetry={() => void fetchDiscover()}
              onNavigate={navigate}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReviewMode({
  loading, error, data, onHome, onReviewedChange, onDiscover,
}: {
  loading: boolean;
  error: string | null;
  data: ReviewQueue | null;
  onHome: () => void;
  onReviewedChange: (n: number) => void;
  onDiscover: () => void;
}) {
  const [stack, setStack] = useState<FlashcardItem[]>([]);
  const [stackReady, setStackReady] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (data) {
      setStack([...data.cards]);
      setStackReady(true);
    }
  }, [data]);

  useEffect(() => { onReviewedChange(reviewed); }, [reviewed, onReviewedChange]);

  const dueCount = data?.due_count ?? 0;
  const serverReviewed = data?.reviewed_today ?? 0;
  const totalDailyTask = dueCount + serverReviewed;
  const totalReviewed = serverReviewed + reviewed;

  const progress = totalDailyTask === 0 ? 1 : Math.min(1, totalReviewed / totalDailyTask);
  const barPct = Math.round(progress * 100);
  const barColor = totalDailyTask === 0 || barPct === 100 ? "#10b981" : barPct <= 10 ? "#ef4444" : "#f59e0b";

  const card = stack[0] ?? null;

  async function handleRemember() {
    if (!card) return;
    setSaving(true);
    await submitReview(card.wordId, true).catch(() => undefined);
    setSaving(false);
    setReviewed((n) => n + 1);
    setStack((prev) => prev.slice(1));
    setFlipped(false);
    if (stack.length <= 1) setDone(true);
  }

  function handleForgot() {
    if (!card) return;
    setFlipped(true);
    void submitReview(card.wordId, false).catch(() => undefined);
  }

  function continueAfterForgot() {
    setStack((prev) => {
      if (prev.length <= 1) { setDone(true); return prev; }
      return [...prev.slice(1), prev[0]];
    });
    setFlipped(false);
  }

  if (loading) return (
    <div className="flex flex-col items-center py-20">
      <Hourglass size={32} className="text-primary animate-pulse mb-3" />
      <p className="text-sm font-body text-text/50 animate-pulse">Loading your review deck…</p>
    </div>
  );

  if (error) return (
    <div className="space-y-4 text-center">
      <ErrorBanner message={error} />
      <button type="button" onClick={onHome} className="rounded-xl border border-red-200 px-4 py-2 text-xs font-heading font-semibold text-red-700 hover:bg-red-100">Back home</button>
    </div>
  );

  if (stackReady && stack.length === 0 && !done) return (
    <EmptyReview onHome={onHome} onDiscover={onDiscover} learningTotal={data?.learning_total ?? 0} />
  );

  if (done || (stackReady && stack.length === 0)) return (
    <DeckDone
      reviewed={reviewed}
      total={dueCount}
      onRestart={() => { setStack(data?.cards ? [...data.cards] : []); setDone(false); setReviewed(0); onReviewedChange(0); }}
      onHome={onHome}
    />
  );

  const examples = card?.examples ?? [];

  return (
    <div className="max-w-md mx-auto">
      <div className="mb-4">
        <div className="flex justify-between text-xs font-body text-text/50 mb-1.5">
          <span>{reviewed} reviewed today</span>
          <span>{dueCount === 0 ? "No words due" : `${Math.max(0, dueCount - reviewed)} remaining`}</span>
        </div>
        <div className="h-2.5 rounded-full bg-black/8 overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: barColor }}
            animate={{ width: dueCount === 0 ? "100%" : `${barPct}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={card?.wordId}
          initial={{ opacity: 0, y: 18, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -18, scale: 0.97 }}
          className="bg-white rounded-2xl shadow-xl shadow-black/8 px-8 py-10"
        >
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary mb-4">
              <BookOpen size={22} />
            </div>
            <p className="text-xs font-body font-semibold text-text/40 uppercase tracking-widest mb-1">Dutch word</p>
            <div className="flex items-center justify-center gap-2">
              <h2 className="font-heading text-3xl font-bold text-text">{card?.dutch}</h2>
              {card?.dutch && (
                <SpeakButton text={card.dutch} label={`Play pronunciation for ${card.dutch}`} className="h-9 w-9 shrink-0" />
              )}
            </div>
            <p className="text-xs font-body text-text/35 mt-2">
              {stack.length - 1 > 0 ? `${stack.length - 1} more in queue` : "Last card"}
            </p>
          </div>

          {!flipped && (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleForgot}
                disabled={saving}
                className="flex-1 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-heading font-semibold text-red-600 hover:bg-red-100 transition-colors"
              >
                I forgot
              </button>
              <button
                type="button"
                onClick={() => void handleRemember()}
                disabled={saving}
                className="flex-1 rounded-xl bg-primary text-white px-4 py-2.5 text-sm font-heading font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? "Saving..." : "I remember"}
              </button>
            </div>
          )}

          <AnimatePresence>
            {flipped && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="border-t border-black/6 pt-5 mb-4">
                  <p className="text-xs font-body font-semibold text-text/40 uppercase tracking-widest mb-1">Meaning</p>
                  <p className="font-heading text-lg font-bold text-primary">{card?.english}</p>
                </div>

                {examples.length > 0 && (
                  <div className="space-y-2 mb-5">
                    {examples.slice(0, 2).map((ex, i) => (
                      <div key={i} className="bg-black/[0.025] rounded-xl px-4 py-3">
                        <p className="text-sm font-body text-text font-medium">{ex.nl}</p>
                        <p className="text-xs font-body text-text/50 mt-0.5">{ex.en}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-center mt-2">
                  <p className="text-xs font-body text-amber-600 font-semibold mb-3">
                    This card will come back later in this session.
                  </p>
                  <button
                    type="button"
                    onClick={continueAfterForgot}
                    className="rounded-xl border border-black/12 px-5 py-2 text-sm font-heading font-semibold text-text hover:bg-black/[0.03]"
                  >
                    Continue
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function DiscoverMode({
  cards, loading, error, onCardDone, onRefreshReview, onRetry, onNavigate,
}: {
  cards: FlashcardItem[];
  loading: boolean;
  error: string | null;
  onCardDone: (wordId: string) => void;
  onRefreshReview: () => void;
  onRetry: () => void;
  onNavigate: (path: string) => void;
}) {
  const [saving, setSaving] = useState(false);

  const card = cards[0] ?? null;

  async function handleKnown() {
    if (!card) return;
    setSaving(true);
    await markKnown(card.wordId).catch(() => undefined);
    setSaving(false);
    onCardDone(card.wordId);
  }

  async function handleAddToLearn() {
    if (!card) return;
    setSaving(true);
    await addToLearn(card.wordId, 1).catch(() => undefined);
    setSaving(false);
    onCardDone(card.wordId);
    onRefreshReview();
  }

  if (!card && loading) return (
    <div className="flex flex-col items-center py-20">
      <Hourglass size={32} className="text-violet-500 animate-pulse mb-3" />
      <p className="text-sm font-body text-text/50 animate-pulse">Choosing new words for you…</p>
    </div>
  );

  if (!card) return (
    <div className="max-w-md mx-auto bg-white rounded-2xl shadow-xl shadow-black/8 px-8 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 mx-auto">
        <Sparkles size={26} className="text-violet-400" strokeWidth={1.6} />
      </div>
      <h2 className="font-heading text-xl font-bold text-text mb-3">
        {error ? "Could not load new words" : "No new words right now"}
      </h2>
      <p className="text-sm font-body text-text/55 leading-relaxed mb-8">
        {error ?? "Try again in a moment, or read a text to meet new words in context."}
      </p>
      <div className="flex gap-3 justify-center">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-xl border border-black/12 px-5 py-2.5 text-sm font-heading font-semibold text-text hover:bg-black/[0.03]"
        >
          <RefreshCw size={14} /> Try again
        </button>
        <button
          type="button"
          onClick={() => onNavigate("/reading")}
          className="rounded-xl bg-primary text-white px-5 py-2.5 text-sm font-heading font-semibold hover:opacity-90"
        >
          Go to Reading
        </button>
      </div>
    </div>
  );

  const examples = card.examples ?? [];

  return (
    <div className="max-w-md mx-auto">
      <div className="flex justify-between text-xs font-body text-text/50 mb-4">
        <span className="flex items-center gap-1.5"><Sparkles size={12} /> Discover mode</span>
        <span>{cards.length} words ready{loading ? " · loading more" : ""}</span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={card.wordId}
          initial={{ opacity: 0, y: 18, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -18, scale: 0.97 }}
          className="bg-white rounded-2xl shadow-xl shadow-black/8 px-8 py-10"
        >
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-violet-50 text-violet-600 mb-4">
              <Sparkles size={22} />
            </div>
            <div className="flex items-center justify-center gap-1.5 mb-2">
              {card.cefrLevel && (
                <span className="inline-block text-[10px] font-heading font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-50 text-violet-600">
                  {card.cefrLevel}
                </span>
              )}
              {card.lookupCount > 0 && (
                <span className="inline-block text-[10px] font-heading font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                  You looked this up
                </span>
              )}
            </div>
            <p className="text-xs font-body font-semibold text-text/40 uppercase tracking-widest mb-1">New word</p>
            <div className="flex items-center justify-center gap-2">
              <h2 className="font-heading text-3xl font-bold text-text">{card.dutch}</h2>
              <SpeakButton text={card.dutch} label={`Play pronunciation for ${card.dutch}`} className="h-9 w-9 shrink-0" />
            </div>
          </div>

          <div className="border-t border-black/6 pt-5 mb-5">
            <p className="text-xs font-body font-semibold text-text/40 uppercase tracking-widest mb-1">Meaning</p>
            <p className="font-heading text-lg font-bold text-violet-600">{card.english}</p>
          </div>

          {examples.length > 0 && (
            <div className="space-y-2 mb-5">
              {examples.slice(0, 2).map((ex, i) => (
                <div key={i} className="bg-black/[0.025] rounded-xl px-4 py-3">
                  <p className="text-sm font-body text-text font-medium">{ex.nl}</p>
                  <p className="text-xs font-body text-text/50 mt-0.5">{ex.en}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void handleKnown()}
              disabled={saving}
              className="flex-1 rounded-xl border border-black/12 px-4 py-2.5 text-sm font-heading font-semibold text-text/70 hover:bg-black/[0.03] disabled:opacity-50"
            >
              I know this word
            </button>
            <button
              type="button"
              onClick={() => void handleAddToLearn()}
              disabled={saving}
              className="flex-1 rounded-xl bg-violet-600 text-white px-4 py-2.5 text-sm font-heading font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Add to review"}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function EmptyReview({ onHome, onDiscover, learningTotal }: { onHome: () => void; onDiscover: () => void; learningTotal: number }) {
  return (
    <div className="max-w-md mx-auto bg-white rounded-2xl shadow-xl shadow-black/8 px-8 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 mx-auto">
        <Check size={28} className="text-emerald-500" strokeWidth={1.8} />
      </div>
      <h2 className="font-heading text-xl font-bold text-text mb-2">No words due right now</h2>
      <p className="text-sm font-body text-text/50 mb-8">
        {learningTotal > 0
          ? `You have ${learningTotal} word${learningTotal === 1 ? "" : "s"} in your queue; they will come back when they are due.`
          : "Add words from readings or Discover mode and they will show up here."}
      </p>
      <div className="flex gap-3 justify-center">
        <button type="button" onClick={onDiscover}
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 text-white px-5 py-2.5 text-sm font-heading font-semibold hover:opacity-90">
          <Sparkles size={14} /> Discover words
        </button>
        <button type="button" onClick={onHome}
          className="rounded-xl border border-black/12 px-5 py-2.5 text-sm font-heading font-semibold text-text hover:bg-black/[0.03]">
          Back home
        </button>
      </div>
    </div>
  );
}

function DeckDone({
  reviewed, total, onRestart, onHome,
}: { reviewed: number; total: number; onRestart: () => void; onHome: () => void }) {
  const pct = total === 0 ? 100 : Math.round((reviewed / total) * 100);
  return (
    <div className="max-w-md mx-auto bg-white rounded-2xl shadow-xl shadow-black/8 px-8 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 mx-auto">
        <Check size={28} className="text-emerald-500" strokeWidth={1.8} />
      </div>
      <h2 className="font-heading text-xl font-bold text-text mb-1">Session complete!</h2>
      <p className="text-2xl font-heading font-black text-emerald-600 mb-1">{pct}%</p>
      <p className="text-sm font-body text-text/50 mb-8">
        {reviewed} of {total} due cards reviewed.
      </p>
      <div className="flex gap-3">
        <button type="button" onClick={onRestart}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-black/12 px-5 py-2.5 text-sm font-heading font-semibold text-text hover:bg-black/[0.03]">
          <RotateCcw size={13} /> Study again
        </button>
        <button type="button" onClick={onHome}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary text-white px-5 py-2.5 text-sm font-heading font-semibold hover:opacity-90">
          <Home size={13} /> Home
        </button>
      </div>
    </div>
  );
}
