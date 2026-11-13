import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings as SettingsIcon,
  User as UserIcon,
  Award,
  Tags,
  Check,
  Save,
  RefreshCw,
  KeyRound,
} from "lucide-react";

import { saveProfile } from "../services/api";
import { easeOut } from "../constants/animation";
import ErrorBanner from "../components/ErrorBanner";
import { useStore } from "../store";
import { INTERESTS, MIN_INTERESTS, MAX_INTERESTS, type InterestId } from "../constants/interests";
import { PURPOSES, type Gender, type Purpose } from "../types";
import { GenderSelect, inputCls } from "./OnboardingPage";

interface ProfileForm {
  display_name: string;
  age: string;
  city: string;
  job: string;
  academic_background: string;
  mother_language: string;
  other_languages: string;
  purpose: Purpose | "";
  gender: Gender | "";
  difficulty_offset: number;
}

const OFFSET_OPTIONS: { value: number; label: string; hint: string }[] = [
  { value: -1, label: "Easier", hint: "one step below your level" },
  { value: 0, label: "My level", hint: "as assessed" },
  { value: 1, label: "Harder", hint: "one step above your level" },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const user = useStore((s) => s.user);
  const setUser = useStore((s) => s.setUser);

  const [interests, setInterestsSet] = useState<Set<InterestId>>(new Set());
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setInterestsSet(new Set(user.interests as InterestId[]));
    setForm({
      display_name: user.display_name ?? "",
      age: user.age != null ? String(user.age) : "",
      city: user.city ?? "",
      job: user.job ?? "",
      academic_background: user.academic_background ?? "",
      mother_language: user.mother_language ?? "",
      other_languages: user.other_languages ?? "",
      purpose: user.purpose ?? "",
      gender: user.gender ?? "",
      difficulty_offset: user.difficultyOffset,
    });
  }, [user]);

  if (!user || !form) return null;

  const interestsDirty = !sameSet(interests, new Set(user.interests as InterestId[]));
  const profileDirty =
    form.display_name !== (user.display_name ?? "") ||
    form.age !== (user.age != null ? String(user.age) : "") ||
    form.city !== (user.city ?? "") ||
    form.job !== (user.job ?? "") ||
    form.academic_background !== (user.academic_background ?? "") ||
    form.mother_language !== (user.mother_language ?? "") ||
    form.other_languages !== (user.other_languages ?? "") ||
    form.purpose !== (user.purpose ?? "") ||
    form.gender !== (user.gender ?? "") ||
    form.difficulty_offset !== user.difficultyOffset;
  const dirty = interestsDirty || profileDirty;

  const validInterestCount = interests.size >= MIN_INTERESTS && interests.size <= MAX_INTERESTS;
  const ageValid = form.age === "" || /^\d{1,3}$/.test(form.age);
  const canSave = dirty && validInterestCount && ageValid;

  function update<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function toggleInterest(id: InterestId) {
    setInterestsSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_INTERESTS) next.add(id);
      return next;
    });
  }

  function flashToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  async function handleSave() {
    if (!canSave || !user || !form) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await saveProfile({
        display_name: form.display_name,
        age: form.age !== "" ? Number(form.age) : undefined,
        city: form.city,
        job: form.job,
        academic_background: form.academic_background,
        mother_language: form.mother_language,
        other_languages: form.other_languages,
        purpose: form.purpose || undefined,
        gender: form.gender,
        difficulty_offset: form.difficulty_offset,
        interests: Array.from(interests),
      });
      setUser(updated);
      flashToast("Settings saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  const signInMethods = [user.hasPassword ? "email and password" : null, user.hasGoogle ? "Google" : null]
    .filter(Boolean)
    .join(" and ");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: easeOut }}
      className="mx-auto max-w-3xl space-y-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SettingsIcon size={17} strokeWidth={2} />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-text">Settings</h1>
            <p className="text-sm font-body text-text/50">
              Everything here shapes your next texts and word recommendations.
            </p>
          </div>
        </div>
        {dirty && (
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-body font-semibold text-primary">
            Unsaved changes
          </span>
        )}
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-700 font-body"
          >
            <Check size={14} />
            {toast}
          </motion.div>
        )}
        {error && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="mb-4">
            <ErrorBanner message={error} />
          </motion.div>
        )}
      </AnimatePresence>

      <Section title="Account" icon={<KeyRound size={14} />}>
        <div className="flex flex-wrap items-center justify-between gap-4 py-1">
          <div>
            <p className="text-xs font-body font-semibold uppercase tracking-wide text-text/50">Email</p>
            <p className="mt-1 font-body text-sm text-text">{user.email}</p>
          </div>
          <span className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] font-body text-text/45">
            signs in with {signInMethods || "email"}
          </span>
        </div>
      </Section>

      <Section title="About you" icon={<UserIcon size={14} />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Labeled label="Name"><input value={form.display_name} onChange={(e) => update("display_name", e.target.value)} className={inputCls} /></Labeled>
          <Labeled label="Age"><input inputMode="numeric" value={form.age} onChange={(e) => update("age", e.target.value.replace(/[^\d]/g, ""))} className={inputCls} /></Labeled>
          <Labeled label="City"><input value={form.city} onChange={(e) => update("city", e.target.value)} className={inputCls} /></Labeled>
          <Labeled label="Job / occupation"><input value={form.job} onChange={(e) => update("job", e.target.value)} className={inputCls} /></Labeled>
          <Labeled label="Academic background"><input value={form.academic_background} onChange={(e) => update("academic_background", e.target.value)} className={inputCls} /></Labeled>
          <Labeled label="Mother language"><input value={form.mother_language} onChange={(e) => update("mother_language", e.target.value)} className={inputCls} /></Labeled>
          <Labeled label="Other languages"><input value={form.other_languages} onChange={(e) => update("other_languages", e.target.value)} className={inputCls} /></Labeled>
          <Labeled label="Purpose of learning Dutch">
            <select value={form.purpose} onChange={(e) => update("purpose", e.target.value as Purpose | "")} className={inputCls}>
              <option value="">Select…</option>
              {PURPOSES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </Labeled>
          <Labeled label="Gender (optional)" hint="Only used so people in your texts feel relatable. Never changes topics or difficulty.">
            <GenderSelect value={form.gender} onChange={(v) => update("gender", v)} />
          </Labeled>
        </div>
      </Section>

      <Section title="Reading level" icon={<Award size={14} />}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg font-heading text-sm font-bold text-white"
              style={{ backgroundColor: "var(--color-secondary)" }}
            >
              {user.cefrLevel ?? "—"}
            </span>
            <div>
              <p className="text-sm font-body font-semibold text-text/75">
                {user.cefrLevel ? `Assessed level ${user.cefrLevel}` : "Not assessed yet"}
              </p>
              <p className="mt-0.5 text-xs font-body text-text/45">Set by the word check.</p>
            </div>
          </div>
          <motion.button
            type="button"
            onClick={() => navigate("/onboarding?step=assessment")}
            whileTap={{ scale: 0.97 }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-black/12 bg-white px-3 py-2 text-xs font-heading font-semibold text-text/80 hover:bg-black/[0.03] hover:border-black/20"
          >
            <RefreshCw size={12} />
            Retake
          </motion.button>
        </div>

        <Labeled
          label="Text difficulty"
          hint="Moves automatically after three ratings in the same direction. You can set it here too."
        >
          <div className="grid grid-cols-3 gap-2">
            {OFFSET_OPTIONS.map((opt) => {
              const active = form.difficulty_offset === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update("difficulty_offset", opt.value)}
                  className={[
                    "rounded-lg border px-3 py-2 text-left transition-colors",
                    active ? "border-primary bg-primary/[0.06]" : "border-black/12 bg-white hover:border-black/25",
                  ].join(" ")}
                >
                  <span className={["block text-xs font-heading font-semibold", active ? "text-primary" : "text-text/75"].join(" ")}>
                    {opt.label}
                  </span>
                  <span className="block text-[11px] font-body text-text/45">{opt.hint}</span>
                </button>
              );
            })}
          </div>
        </Labeled>
      </Section>

      <Section title="Interests" icon={<Tags size={14} />}>
        <Labeled label="Topics" hint={`${interests.size} selected · choose ${MIN_INTERESTS}–${MAX_INTERESTS}`}>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {INTERESTS.map((it) => {
              const active = interests.has(it.id);
              const disabled = !active && interests.size >= MAX_INTERESTS;
              const Icon = it.icon;
              return (
                <motion.button
                  key={it.id}
                  type="button"
                  onClick={() => toggleInterest(it.id)}
                  disabled={disabled}
                  whileTap={disabled ? {} : { scale: 0.95 }}
                  className={[
                    "flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-body font-semibold transition-colors",
                    active
                      ? "border-primary bg-primary/[0.06] text-primary"
                      : disabled
                      ? "border-black/8 bg-black/[0.02] text-text/25 cursor-not-allowed"
                      : "border-black/12 bg-white text-text/65 hover:border-black/25 hover:bg-black/[0.02]",
                  ].join(" ")}
                  aria-pressed={active}
                >
                  <Icon size={13} strokeWidth={1.8} />
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {active && <Check size={12} strokeWidth={2.8} />}
                </motion.button>
              );
            })}
          </div>
          {!validInterestCount && (
            <p className="mt-2 text-[11px] font-body text-red-500">
              Please pick between {MIN_INTERESTS} and {MAX_INTERESTS} interests.
            </p>
          )}
        </Labeled>
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-xs font-body text-text/45">
          Changes apply to your next reading and your next batch of new words.
        </p>
        <motion.button
          type="button"
          onClick={handleSave}
          disabled={!canSave || saving}
          whileTap={canSave && !saving ? { scale: 0.97 } : {}}
          className={[
            "inline-flex items-center gap-2 rounded-xl px-5 py-2.5",
            "text-sm font-heading font-semibold transition-opacity",
            canSave && !saving ? "bg-primary text-white hover:opacity-90" : "bg-black/8 text-text/40 cursor-not-allowed",
          ].join(" ")}
        >
          {saving ? <Spinner /> : <Save size={14} />}
          Save
        </motion.button>
      </div>
    </motion.div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-black/8 bg-white px-5 py-5 shadow-sm shadow-black/5">
      <div className="mb-4 flex items-center gap-2">
        {icon && <span className="text-text/40">{icon}</span>}
        <h2 className="font-heading text-sm font-bold text-text uppercase tracking-wide">{title}</h2>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs font-body font-semibold text-text/60 uppercase tracking-wide">{label}</label>
        {hint && <span className="text-[11px] font-body text-text/40">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
