import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen, CheckCircle2, ChevronRight, Loader2, Search, Sparkles } from "lucide-react";

import { generateSession, listSessions } from "../services/api";
import { easeOut } from "../constants/animation";
import type { SessionSummary } from "../types";
import ErrorBanner from "../components/ErrorBanner";
import ReadingGenerationStatus from "../components/ReadingGenerationStatus";
import { useStore } from "../store";

export default function ReadingPage() {
  const navigate = useNavigate();
  const user = useStore((s) => s.user);
  const userId = user?.id;

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const refreshSessions = useCallback(async () => {
    if (!userId) return;
    try {
      setSessions(await listSessions());
    } finally {
      setLoadingList(false);
    }
  }, [userId]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    function refreshOnFocus() {
      void refreshSessions();
    }
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [refreshSessions]);

  if (!user) return null;

  async function handleGenerate() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const session = await generateSession();
      await refreshSessions();
      navigate(`/read/${session.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      await refreshSessions();
    } finally {
      setLoading(false);
    }
  }

  const inProgress = sessions.filter((s) => !s.ended).length;
  const filteredHistory = query.trim()
    ? sessions.filter((s) =>
        (s.title + " " + (s.topic_used ?? "")).toLowerCase().includes(query.toLowerCase())
      )
    : sessions;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: easeOut }}
      className="mx-auto max-w-3xl space-y-6"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <BookOpen size={18} strokeWidth={2} />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-text">Reading</h1>
          <p className="text-sm font-body text-text/50">
            Every text is written for your level, your interests and the words you are learning.
          </p>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="rounded-lg border border-black/8 bg-white px-5 py-5 shadow-sm shadow-black/5">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles size={20} strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-heading text-base font-bold text-text">Create your reading</h2>
            <p className="text-xs text-text/50 font-body">
              {user.effectiveCefr ?? user.cefrLevel ?? "Your"} level
              {user.interests.length > 0 ? ` · ${user.interests.slice(0, 3).join(", ")}` : ""}
              {inProgress > 0 ? ` · ${inProgress} reading${inProgress === 1 ? "" : "s"} in progress` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <motion.button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading}
            whileTap={loading ? {} : { scale: 0.97 }}
            className={[
              "inline-flex items-center gap-2 rounded-lg px-5 py-2.5",
              "text-sm font-heading font-semibold text-white bg-primary transition-opacity",
              loading ? "opacity-60 cursor-wait" : "hover:opacity-90",
            ].join(" ")}
          >
            {loading ? (
              <><Loader2 size={16} className="animate-spin" /> Generating…</>
            ) : (
              <><BookOpen size={15} /> Generate<ArrowRight size={15} /></>
            )}
          </motion.button>
          <p className="text-xs font-body text-text/45">Takes about half a minute.</p>
        </div>
        {loading && <ReadingGenerationStatus className="mt-4" />}
      </div>

      {loadingList ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-black/4 animate-pulse" />
          ))}
        </div>
      ) : sessions.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="font-heading text-sm font-bold text-text flex-1">Reading history</h3>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text/30" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="rounded-lg border border-black/10 bg-white pl-8 pr-3 py-1.5 text-xs font-body text-text placeholder:text-text/35 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
              />
            </div>
          </div>
          {filteredHistory.length === 0 ? (
            <p className="text-sm font-body text-text/45 py-6 text-center">No readings match "{query}".</p>
          ) : (
            <ul className="space-y-2">
              {filteredHistory.map((s) => (
                <li key={s.session_id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/read/${s.session_id}`)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-black/8 bg-white px-5 py-4 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.02]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {s.topic_used && (
                          <span className="text-[10px] font-heading font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                            {s.topic_used}
                          </span>
                        )}
                        {s.cefr_level && (
                          <span className="text-[10px] font-heading font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-secondary/15 text-amber-800">
                            {s.cefr_level}
                          </span>
                        )}
                        {s.ended ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-heading font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                            <CheckCircle2 size={10} /> Ended
                          </span>
                        ) : (
                          <span className="text-[10px] font-heading font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                            In progress
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-heading font-semibold text-text truncate">{s.title}</p>
                      <p className="text-xs font-body text-text/45 mt-1">
                        {s.created_at ? relTime(s.created_at) : "Unknown date"}
                        {s.continuation_count > 0 ? ` · ${s.continuation_count + 1} parts` : ""}
                      </p>
                    </div>
                    <ChevronRight size={16} className="text-text/30 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-sm font-body text-text/45 py-4 text-center">
          Your readings will appear here. Generate your first one above.
        </p>
      )}
    </motion.div>
  );
}

function relTime(iso: string): string {
  const then = parseBackendTime(iso);
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

function parseBackendTime(iso: string): number {
  const value = iso.trim().replace(" ", "T");
  const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value);
  return new Date(hasTimezone ? value : `${value}Z`).getTime();
}
