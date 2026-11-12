import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Star, X } from "lucide-react";

import type { Rating, ReadingFeedback } from "../../types";

const DIFFICULTY_OPTIONS: { value: Rating; label: string }[] = [
  { value: 1, label: "Too easy" },
  { value: 2, label: "Easy" },
  { value: 3, label: "Normal" },
  { value: 4, label: "Difficult" },
  { value: 5, label: "Too difficult" },
];

const STAR_QUESTIONS: { key: keyof Omit<ReadingFeedback, "difficulty">; label: string }[] = [
  { key: "interest", label: "Interesting?" },
  { key: "relevance", label: "Relevant to you?" },
  { key: "worth_time", label: "Worth your time?" },
];

type Props = {
  open: boolean;
  submitting?: boolean;
  onSubmit: (feedback: ReadingFeedback) => void;
  onSkip: () => void;
  onClose: () => void;
};

export default function EndReadingModal({ open, submitting = false, onSubmit, onSkip, onClose }: Props) {
  const [difficulty, setDifficulty] = useState<Rating | null>(null);
  const [stars, setStars] = useState<Record<string, Rating | null>>({
    interest: null,
    relevance: null,
    worth_time: null,
  });

  useEffect(() => {
    if (open) {
      setDifficulty(null);
      setStars({ interest: null, relevance: null, worth_time: null });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !submitting) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, submitting]);

  const complete =
    difficulty !== null && STAR_QUESTIONS.every((q) => stars[q.key] !== null);

  function handleSubmit() {
    if (!complete || submitting || difficulty === null) return;
    onSubmit({
      difficulty,
      interest: stars.interest as Rating,
      relevance: stars.relevance as Rating,
      worth_time: stars.worth_time as Rating,
    });
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 px-4 pb-4 sm:items-center sm:pb-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => !submitting && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="end-reading-title"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl shadow-black/20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 id="end-reading-title" className="font-heading text-lg font-bold text-text">
                  How was this reading?
                </h2>
                <p className="text-xs font-body text-text/45">Four quick taps help us pick your next text.</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-lg p-1 text-text/40 hover:bg-black/5 hover:text-text"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mb-5">
              <p className="mb-2 text-xs font-body font-semibold uppercase tracking-wide text-text/55">
                Difficulty
              </p>
              <div role="radiogroup" aria-label="Difficulty" className="grid grid-cols-5 gap-1.5">
                {DIFFICULTY_OPTIONS.map((opt) => {
                  const active = difficulty === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setDifficulty(opt.value)}
                      className={[
                        "rounded-xl border px-1 py-2 text-[11px] sm:text-xs font-heading font-semibold leading-tight transition-colors",
                        active
                          ? "border-primary bg-primary text-white"
                          : "border-black/12 bg-white text-text/70 hover:border-primary/40 hover:bg-primary/[0.04]",
                      ].join(" ")}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              {STAR_QUESTIONS.map((q) => (
                <StarRow
                  key={q.key}
                  label={q.label}
                  value={stars[q.key]}
                  onChange={(v) => setStars((prev) => ({ ...prev, [q.key]: v }))}
                />
              ))}
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={onSkip}
                disabled={submitting}
                className="flex-1 rounded-xl border border-black/12 px-4 py-2.5 text-sm font-heading font-semibold text-text/70 hover:bg-black/[0.03] disabled:opacity-50"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!complete || submitting}
                className={[
                  "flex-1 rounded-xl px-4 py-2.5 text-sm font-heading font-semibold text-white transition-opacity",
                  complete && !submitting ? "bg-primary hover:opacity-90" : "bg-primary/40 cursor-not-allowed",
                ].join(" ")}
              >
                {submitting ? "Saving…" : "Submit"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StarRow({ label, value, onChange }: {
  label: string;
  value: Rating | null;
  onChange: (value: Rating) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;

  function onKeyDown(e: React.KeyboardEvent) {
    const current = value ?? 0;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(5, current + 1) as Rating);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(1, current - 1) as Rating);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-body text-text/80">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseLeave={() => setHover(null)}
        className="flex items-center gap-0.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= shown;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              tabIndex={-1}
              onMouseEnter={() => setHover(n)}
              onTouchStart={() => setHover(n)}
              onTouchEnd={() => setHover(null)}
              onClick={() => onChange(n as Rating)}
              className="p-1 transition-transform active:scale-90"
            >
              <Star
                size={26}
                strokeWidth={1.6}
                className={filled ? "text-amber-400" : "text-black/20"}
                fill={filled ? "currentColor" : "none"}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
