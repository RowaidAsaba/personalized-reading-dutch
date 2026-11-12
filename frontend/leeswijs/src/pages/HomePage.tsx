import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  BookOpen,
  BrainCircuit,
  ArrowRight,
  Layers,
  RefreshCw,
  Sparkles,
  Trophy,
} from "lucide-react";
import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { easeOut } from "../constants/animation";
import { useStore } from "../store";
import { apiClient } from "../services/api";

import type { DashboardStats } from "../types";


export default function HomePage() {
  const user = useStore((s) => s.user);
  const navigate = useNavigate();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    apiClient
      .get<DashboardStats>("/users/me/dashboard-stats")
      .then((r) => setStats(r.data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return null;

  const name = user.display_name || user.name || "there";

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: easeOut }}
        className="mx-auto max-w-4xl space-y-6"
      >
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold text-text">
            Welcome back, {name} 👋
          </h1>
          <p className="mt-1 text-sm text-text/55 font-body">
            Here's a snapshot of your Dutch learning journey.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/reading")}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-heading font-semibold text-white hover:opacity-90 transition-opacity"
        >
          <BookOpen size={15} /> New reading
        </button>
      </div>

      {loading ? (
        <SkeletonGrid />
      ) : stats?.is_new ? (
        <NewJourneyBanner onStart={() => navigate("/reading")} />
      ) : !stats ? (
        <NewJourneyBanner onStart={() => navigate("/reading")} />
      ) : (
        <Dashboard stats={stats} onNavigate={navigate} />
      )}
      </motion.div>
    </>
  );
}

function Dashboard({
  stats,
  onNavigate,
}: {
  stats: DashboardStats;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="space-y-5">
      <NextActionBanner stats={stats} onNavigate={onNavigate} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <CefrCard level={stats.cefr_level} effective={stats.effective_cefr} />
        <AcquisitionCard score={stats.acquisition_score} known={stats.total_known} goal={stats.words_known_goal} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          icon={<Trophy size={18} />}
          label="Words Known"
          value={stats.total_known}
          accent="#0D7377"
          onClick={() => onNavigate("/flashcards")}
        />
        <StatCard
          icon={<Layers size={18} />}
          label="In Learning"
          value={stats.total_learning}
          accent="#7C3AED"
          onClick={() => onNavigate("/flashcards")}
        />
        <StatCard
          icon={<BrainCircuit size={18} />}
          label="Readings Done"
          value={stats.readings_completed}
          accent="#D97706"
          onClick={() => onNavigate("/reading")}
        />
        <DailyGoalCard stats={stats} onClick={() => onNavigate("/flashcards")} />
      </div>

      <ProductivityChart stats={stats} />
    </div>
  );
}

function NextActionBanner({
  stats,
  onNavigate,
}: {
  stats: DashboardStats;
  onNavigate: (path: string) => void;
}) {
  const hasReviews = stats.to_review > 0;
  const inProgress = Math.max(0, stats.readings_total - stats.readings_completed);
  const target = hasReviews ? "/flashcards" : "/reading";
  const title = hasReviews
    ? "Review words due today"
    : inProgress > 0
      ? "Continue your reading"
      : "Start a new reading";
  const body = hasReviews
    ? `${stats.to_review} word${stats.to_review === 1 ? " is" : "s are"} ready for review before your next text.`
    : inProgress > 0
      ? `You have ${inProgress} reading${inProgress === 1 ? "" : "s"} in progress. Pick up where you left off.`
      : "A new text at your level, about the things you care about, is one tap away.";
  const button = hasReviews ? "Open flashcards" : inProgress > 0 ? "Open reading" : "New reading";

  return (
    <div className="rounded-2xl border border-primary/15 bg-primary/[0.04] px-5 py-4 shadow-sm shadow-black/5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-body font-semibold uppercase tracking-wide text-primary/70">
            Next step
          </p>
          <h2 className="mt-1 font-heading text-lg font-bold text-text">{title}</h2>
          <p className="mt-1 text-sm font-body text-text/55">{body}</p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate(target)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-heading font-semibold text-white hover:opacity-90"
        >
          {button} <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

const CEFR_META: Record<string, { color: string; label: string }> = {
  A1: { color: "#94A3B8", label: "Beginner" },
  A2: { color: "#60A5FA", label: "Elementary" },
  B1: { color: "#34D399", label: "Intermediate" },
  B2: { color: "#FBBF24", label: "Upper Intermediate" },
  C1: { color: "#F97316", label: "Advanced" },
  C2: { color: "#A855F7", label: "Mastery" },
  "—": { color: "#9CA3AF", label: "Not assessed yet" },
};

function CefrCard({ level, effective }: { level: string; effective: string | null }) {
  const meta = CEFR_META[level] ?? CEFR_META["—"];
  const shifted = effective && effective !== level;
  return (
    <Card>
      <p className="text-xs font-body font-semibold uppercase tracking-wide text-text/40 mb-3">
        Current CEFR Level
      </p>
      <div className="flex items-center gap-4">
        <div
          className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl text-white font-heading text-3xl font-black shadow-lg"
          style={{ backgroundColor: meta.color }}
        >
          {level}
        </div>
        <div>
          <p className="font-heading text-xl font-bold text-text">{meta.label}</p>
          <p className="text-xs font-body text-text/50 mt-1">
            Common European Framework of Reference
          </p>
          <div
            className="mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-heading font-semibold"
            style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
          >
            <Sparkles size={11} /> {shifted ? `Texts at ${effective}` : "Active level"}
          </div>
        </div>
      </div>
    </Card>
  );
}

function AcquisitionCard({ score, known, goal }: { score: number; known: number; goal: number }) {
  const pct = Math.min(100, Math.max(0, Math.round(score)));
  const ringData = [{ value: pct }, { value: 100 - pct }];

  return (
    <Card>
      <p className="text-xs font-body font-semibold uppercase tracking-wide text-text/40 mb-3">
        Words known
      </p>
      <div className="flex items-center gap-5">
        <div className="relative h-24 w-24 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              cx="50%"
              cy="50%"
              innerRadius="65%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              data={ringData}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar dataKey="value" cornerRadius={6} background={{ fill: "#F1F5F9" }}>
                <Cell fill="#7C3AED" />
                <Cell fill="transparent" />
              </RadialBar>
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-heading text-lg font-black text-text">{pct}%</span>
          </div>
        </div>
        <div>
          <p className="font-heading text-xl font-bold text-text">{known.toLocaleString()}</p>
          <p className="text-xs font-body text-text/50 mt-1">
            of your {goal.toLocaleString()}-word goal
          </p>
          <div className="mt-3 h-1.5 rounded-full bg-black/8 w-32">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: "#7C3AED" }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

function DailyGoalCard({ stats, onClick }: { stats: DashboardStats; onClick: () => void }) {
  const isDone = stats.to_review === 0 && stats.reviewed_today > 0;
  const isNew = stats.to_review === 0 && stats.reviewed_today === 0;
  
  let accent = "#6B7280";
  if (isDone) accent = "#10B981";
  else if (stats.to_review > 0) accent = "#F59E0B";

  const pct = isNew ? 0 : isDone ? 100 : Math.round(stats.daily_progress);

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      className={[
        "rounded-2xl border bg-white px-5 py-4 text-left shadow-sm shadow-black/5 w-full transition-shadow relative overflow-hidden",
        stats.to_review > 0 ? "border-amber-200 ring-1 ring-amber-200" : "border-black/8 hover:border-black/15 hover:shadow-md hover:shadow-black/8",
      ].join(" ")}
    >
      <div className="flex justify-between items-start mb-2">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${accent}18`, color: accent }}
        >
          {isDone ? <Trophy size={18} /> : <RefreshCw size={18} />}
        </div>
        <div className="text-right">
          <p className="font-heading text-xl font-black text-text">
            {isDone ? "Done" : stats.to_review}
          </p>
        </div>
      </div>
      
      <p className="text-xs font-body text-text/50 mb-3 mt-1">Daily Review Goal</p>
      
      <div className="h-1.5 w-full bg-black/5 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: accent }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      </div>
    </motion.button>
  );
}

function StatCard({
  icon, label, value, accent, onClick, highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent: string;
  onClick?: () => void;
  highlight?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      className={[
        "rounded-2xl border bg-white px-5 py-5 text-left shadow-sm shadow-black/5 w-full transition-shadow",
        highlight ? "border-red-200 ring-1 ring-red-200" : "border-black/8 hover:border-black/15 hover:shadow-md hover:shadow-black/8",
      ].join(" ")}
    >
      <div
        className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${accent}18`, color: accent }}
      >
        {icon}
      </div>
      <p className="font-heading text-2xl font-black text-text">{value}</p>
      <p className="text-xs font-body text-text/50 mt-0.5">{label}</p>
    </motion.button>
  );
}

function ProductivityChart({ stats }: { stats: DashboardStats }) {
  const data = stats.productivity_data || [];
  const avg = stats.avg_duration_min || 0;

  if (data.length === 0) {
    return (
      <Card>
        <p className="text-xs font-body font-semibold uppercase tracking-wide text-text/40 mb-3">
          Reading Productivity
        </p>
        <div className="flex items-center justify-center h-48 rounded-xl bg-black/[0.025] border border-dashed border-black/12">
          <p className="text-sm font-body text-text/35">
            Productivity data will appear after your first reading session.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs font-body font-semibold uppercase tracking-wide text-text/40">
            Reading Productivity
          </p>
          <p className="font-heading text-base font-bold text-text mt-0.5">
            Duration vs. Average
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-body font-bold text-text/40 uppercase tracking-wider">Avg. Time</p>
          <p className="font-heading text-lg font-black text-primary">{avg}m</p>
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <XAxis 
              dataKey="session_name" 
              tick={{ fontSize: 10, fill: "#94A3B8" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis 
              tick={{ fontSize: 10, fill: "#94A3B8" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip 
              cursor={{ fill: "transparent" }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-white p-3 rounded-xl shadow-xl border border-black/5">
                      <p className="text-[10px] font-bold text-text/40 uppercase mb-1">{payload[0].payload.session_name}</p>
                      <p className="font-heading text-sm font-bold text-primary">{payload[0].value} minutes</p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <ReferenceLine y={avg} stroke="#0D7377" strokeDasharray="3 3" label={{ position: "right", value: "Avg", fill: "#0D7377", fontSize: 10 }} />
            <Bar dataKey="duration_min" radius={[6, 6, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.duration_min > avg ? "#7C3AED" : "#10B981"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function NewJourneyBanner({ onStart }: { onStart: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "linear-gradient(135deg, #7C3AED 0%, #0D7377 100%)" }}
    >
      <div className="px-8 py-10 text-white">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-heading font-semibold">
          <Sparkles size={11} /> New Journey Started!
        </div>
        <h2 className="font-heading text-2xl font-black mt-3 mb-2">
          Your dashboard is getting ready 🚀
        </h2>
        <p className="text-sm font-body text-white/80 max-w-md mb-6">
          Finish your first reading and review a few words to see your progress here: level, words known, and reading time.
        </p>
        <button
          type="button"
          onClick={onStart}
          className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-heading font-semibold text-[#7C3AED] hover:opacity-90 transition-opacity"
        >
          <BookOpen size={15} /> Start first reading
        </button>
      </div>
    </motion.div>
  );
}

function SkeletonGrid() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {[1, 2].map((i) => (
          <div key={i} className="h-36 rounded-2xl bg-black/5 animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-2xl bg-black/5 animate-pulse" />
        ))}
      </div>
      <div className="h-52 rounded-2xl bg-black/5 animate-pulse" />
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/8 bg-white px-6 py-5 shadow-sm shadow-black/5">
      {children}
    </div>
  );
}
