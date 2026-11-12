import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Award,
  BookOpen,
  LogOut,
  Mail,
  RefreshCw,
  Settings as SettingsIcon,
  Tags,
  User as UserIcon,
} from "lucide-react";

import { INTERESTS } from "../constants/interests";
import { easeOut } from "../constants/animation";
import { useStore } from "../store";

function interestLabel(id: string) {
  return INTERESTS.find((item) => item.id === id)?.label ?? id;
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const user = useStore((s) => s.user);
  const clearUser = useStore((s) => s.clearUser);

  if (!user) return null;

  function handleLogout() {
    clearUser();
    navigate("/login", { replace: true });
  }

  const offset = user.difficultyOffset;
  const levelNote =
    offset === 0
      ? "Your assessed level."
      : `Assessed ${user.cefrLevel ?? "—"}, texts currently ${offset > 0 ? "one step harder" : "one step easier"} based on your feedback.`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: easeOut }}
      className="mx-auto max-w-3xl space-y-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UserIcon size={17} />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-text">{user.name}</h1>
            <p className="text-sm font-body text-text/50">What LeesWijs knows about you.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate("/settings")}
          className="inline-flex items-center gap-2 rounded-lg border border-black/12 bg-white px-3 py-2 text-xs font-heading font-semibold text-text/70 hover:bg-black/[0.03]"
        >
          <SettingsIcon size={13} />
          Settings
        </button>
      </div>

      <section className="rounded-lg border border-black/8 bg-white px-5 py-5 shadow-sm shadow-black/5">
        <div className="grid gap-4 sm:grid-cols-2">
          <InfoBlock icon={<Mail size={14} />} label="Email" value={user.email} />
          <InfoBlock
            icon={<Award size={14} />}
            label="Reading level"
            value={user.effectiveCefr ?? user.cefrLevel ?? "Not assessed"}
            hint={levelNote}
          />
        </div>

        <div className="mt-5 border-t border-black/8 pt-4">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-body font-semibold uppercase tracking-wide text-text/50">
            <Tags size={13} />
            Interests
          </div>
          <div className="flex flex-wrap gap-1.5">
            {user.interests.length === 0 ? (
              <span className="text-sm font-body text-text/45">No interests selected.</span>
            ) : (
              user.interests.map((id) => (
                <span key={id} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-body font-semibold text-primary">
                  {interestLabel(id)}
                </span>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-black/8 bg-white px-5 py-5 shadow-sm shadow-black/5">
        <h2 className="font-heading text-sm font-bold text-text">Quick actions</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <ActionButton
            icon={<BookOpen size={15} />}
            label="Start reading"
            hint="Generate a new Dutch text"
            onClick={() => navigate("/reading")}
          />
          <ActionButton
            icon={<RefreshCw size={15} />}
            label="Retake the word check"
            hint="Re-estimate your level"
            onClick={() => navigate("/onboarding?step=assessment")}
          />
        </div>
      </section>

      <button
        type="button"
        onClick={handleLogout}
        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/60 px-4 py-2.5 text-sm font-heading font-semibold text-red-600 hover:bg-red-50"
      >
        <LogOut size={15} />
        Log out
      </button>
    </motion.div>
  );
}

function InfoBlock({ icon, label, value, hint }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-black/8 bg-black/[0.015] px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-body font-semibold uppercase tracking-wide text-text/45">
        <span>{icon}</span>
        {label}
      </div>
      <p className="mt-2 font-heading text-lg font-semibold text-text break-all">{value}</p>
      {hint && <p className="mt-1 text-xs font-body text-text/45">{hint}</p>}
    </div>
  );
}

function ActionButton({ icon, label, hint, onClick }: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 text-left hover:border-primary/25 hover:bg-primary/[0.03]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <span>
        <span className="block font-heading text-sm font-semibold text-text">{label}</span>
        <span className="mt-0.5 block text-xs font-body text-text/45">{hint}</span>
      </span>
    </button>
  );
}
