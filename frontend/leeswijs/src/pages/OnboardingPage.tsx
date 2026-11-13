import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, ArrowRight, Check, Hourglass } from "lucide-react";

import { useStore } from "../store";
import { getAssessmentBatch, saveProfile, submitAssessment } from "../services/api";
import { INTERESTS, MAX_INTERESTS, MIN_INTERESTS, type InterestId } from "../constants/interests";
import { CEFR_LEVELS, GENDERS, PURPOSES, type Gender, type Purpose } from "../types";

const TOTAL_BATCHES = 2;

type Step = "personal" | "interests" | "assessment";
type BatchResult = Awaited<ReturnType<typeof getAssessmentBatch>>;

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const user = useStore((s) => s.user);
  const setUser = useStore((s) => s.setUser);
  const retakeAssessment = searchParams.get("step") === "assessment";

  const [step, setStep] = useState<Step>(retakeAssessment ? "assessment" : "personal");

  const [name, setName] = useState(user?.display_name ?? "");
  const [age, setAge] = useState<number | "">(user?.age ?? "");
  const [city, setCity] = useState(user?.city ?? "");
  const [job, setJob] = useState(user?.job ?? "");
  const [academic, setAcademic] = useState(user?.academic_background ?? "");
  const [motherLang, setMotherLang] = useState(user?.mother_language ?? "");
  const [otherLangs, setOtherLangs] = useState(user?.other_languages ?? "");
  const [purpose, setPurpose] = useState<Purpose | "">(user?.purpose ?? "");
  const [gender, setGender] = useState<Gender | "">(user?.gender ?? "");
  const [selfCefr, setSelfCefr] = useState<string>(user?.cefrLevel ?? "B1");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingStep, setSavingStep] = useState(false);

  const [selectedInterests, setSelectedInterests] = useState<Set<InterestId>>(
    new Set((user?.interests ?? []) as InterestId[]),
  );

  const [batchNum, setBatchNum] = useState(1);
  const [batch, setBatch] = useState<BatchResult | null>(null);
  const [knownIds, setKnownIds] = useState<Set<string>>(new Set());
  const [allKnownIds, setAllKnownIds] = useState<Set<string>>(new Set());
  const [allWordsSeen, setAllWordsSeen] = useState<Array<{ wordId: string; dutch: string }>>([]);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [calculatingResults, setCalculatingResults] = useState(false);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [assessmentDone, setAssessmentDone] = useState(false);
  const [finalResult, setFinalResult] = useState<{ level: string; acquisition: number } | null>(null);

  useEffect(() => {
    if (!user) navigate("/login", { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    if (!retakeAssessment || !user?.id) return;
    let cancelled = false;
    setStep("assessment");
    setLoadingBatch(true);
    setAssessmentError(null);
    getAssessmentBatch(1, selfCefr)
      .then((res) => {
        if (cancelled) return;
        setBatch(res);
        if (!hasAssessmentWords(res)) setAssessmentError(assessmentBatchError(res));
      })
      .finally(() => { if (!cancelled) setLoadingBatch(false); });
    return () => { cancelled = true; };
  }, [retakeAssessment, selfCefr, user?.id]);

  async function handlePersonalNext() {
    if (!user || savingStep) return;
    setSavingStep(true);
    setSaveError(null);
    try {
      const updated = await saveProfile({
        display_name: name.trim() || undefined,
        age: age !== "" ? Number(age) : undefined,
        city,
        job,
        academic_background: academic,
        mother_language: motherLang,
        other_languages: otherLangs || undefined,
        purpose: purpose || undefined,
        gender,
        estimated_cefr: selfCefr,
      });
      setUser(updated);
      setStep("interests");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save your details.");
    } finally {
      setSavingStep(false);
    }
  }

  function toggleInterest(id: InterestId) {
    setSelectedInterests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_INTERESTS) next.add(id);
      return next;
    });
  }

  async function handleInterestsNext() {
    if (!user || selectedInterests.size < MIN_INTERESTS || savingStep) return;
    setSavingStep(true);
    setSaveError(null);
    try {
      const updated = await saveProfile({ interests: [...selectedInterests] });
      setUser(updated);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save your interests.");
      setSavingStep(false);
      return;
    }
    setSavingStep(false);
    setStep("assessment");
    setLoadingBatch(true);
    setAssessmentError(null);
    const res = await getAssessmentBatch(1, selfCefr);
    setBatch(res);
    if (!hasAssessmentWords(res)) setAssessmentError(assessmentBatchError(res));
    setLoadingBatch(false);
  }

  function toggleWord(wordId: string) {
    setKnownIds((prev) => {
      const next = new Set(prev);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      return next;
    });
  }

  async function handleNextBatch() {
    if (!user || !batch || !batch.success) return;

    const words = batch.data.words;
    const knownAfterThisBatch = new Set([...allKnownIds, ...knownIds]);
    const wordsSeenAfterThisBatch = [...allWordsSeen, ...words.map((w) => ({ wordId: w.wordId, dutch: w.dutch }))];

    if (batchNum < TOTAL_BATCHES) {
      setAllKnownIds(knownAfterThisBatch);
      setAllWordsSeen(wordsSeenAfterThisBatch);
      setKnownIds(new Set());
      setBatchNum((n) => n + 1);
      setLoadingBatch(true);
      setAssessmentError(null);
      const res = await getAssessmentBatch(
        batchNum + 1, selfCefr,
        [...knownAfterThisBatch].map((id) => wordsSeenAfterThisBatch.find((w) => w.wordId === id)?.dutch ?? "").filter(Boolean),
        wordsSeenAfterThisBatch.map((w) => w.dutch),
      );
      setBatch(res);
      if (!hasAssessmentWords(res)) setAssessmentError(assessmentBatchError(res));
      setLoadingBatch(false);
      return;
    }

    setCalculatingResults(true);
    const realWordsInFinalBatch = words.filter((w) => !w.isPseudo);
    const knownRealWordsInFinalBatch = realWordsInFinalBatch.filter((w) => knownIds.has(w.wordId));
    const acquisitionScore = realWordsInFinalBatch.length > 0
      ? knownRealWordsInFinalBatch.length / realWordsInFinalBatch.length
      : 0;

    const levelIndex = CEFR_LEVELS.findIndex((level) => level === selfCefr);
    const cefrIndex = levelIndex !== -1 ? levelIndex : 2;
    let finalLevel: string = selfCefr;
    if (acquisitionScore > 0.8) {
      finalLevel = CEFR_LEVELS[Math.min(CEFR_LEVELS.length - 1, cefrIndex + 1)];
    } else if (acquisitionScore < 0.5) {
      finalLevel = CEFR_LEVELS[Math.max(0, cefrIndex - 1)];
    }

    try {
      const result = await submitAssessment(
        batchNum,
        [...knownAfterThisBatch].filter((id) => !id.startsWith("pseudo")),
        wordsSeenAfterThisBatch.filter((w) => !w.wordId.startsWith("pseudo")).map((w) => w.wordId),
        finalLevel,
        Math.min(0.95, 0.5 + Math.max(0, acquisitionScore) * 0.45),
        true,
      );
      finalLevel = result.estimatedCefr ?? finalLevel;
    } catch (err) {
      setAssessmentError(err instanceof Error ? err.message : "Could not save your results.");
      setCalculatingResults(false);
      return;
    }

    setUser({
      ...user,
      cefrLevel: finalLevel as typeof user.cefrLevel,
      effectiveCefr: finalLevel as typeof user.effectiveCefr,
      difficultyOffset: 0,
      onboarding_completed: true,
    });
    setFinalResult({ level: finalLevel, acquisition: Math.round(acquisitionScore * 100) });
    setCalculatingResults(false);
    setAssessmentDone(true);
  }

  if (!user) return null;

  if (calculatingResults) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-xl shadow-black/8 px-8 py-20 text-center flex flex-col items-center justify-center"
      >
        <Hourglass size={36} className="text-primary animate-pulse mb-5" />
        <h2 className="font-heading text-xl font-bold text-text mb-2">Setting up your profile</h2>
        <p className="text-sm font-body text-text/60 animate-pulse">
          Picking your first words and preparing your reading level...
        </p>
      </motion.div>
    );
  }

  if (assessmentDone && finalResult) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-xl shadow-black/8 px-8 py-10 text-center"
      >
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 mx-auto">
          <Check size={28} className="text-emerald-600" strokeWidth={1.8} />
        </div>
        <h2 className="font-heading text-2xl font-bold text-text mb-2">You're all set</h2>
        <div className="bg-black/[0.02] border border-black/10 rounded-xl p-6 mb-8 inline-block text-left w-full max-w-sm">
          <p className="text-sm font-body text-text/60 mb-1">Estimated Dutch level:</p>
          <p className="font-heading text-xl font-bold text-primary mb-4">{finalResult.level}</p>
          <p className="text-sm font-body text-text/60 mb-1">Words you already knew in the check:</p>
          <p className="font-heading text-xl font-bold text-secondary">{finalResult.acquisition}%</p>
        </div>
        <button
          type="button"
          onClick={() => navigate(retakeAssessment ? "/settings" : "/home", { replace: true })}
          className="inline-flex items-center justify-center w-full max-w-sm gap-2 bg-primary text-white rounded-xl px-6 py-3 text-sm font-heading font-semibold hover:opacity-90"
        >
          {retakeAssessment ? "Back to settings" : "Start reading"} <ArrowRight size={16} />
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl shadow-xl shadow-black/8 px-8 py-9"
    >
      <StepIndicator step={step} />

      {saveError && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700 font-body">{saveError}</p>
        </div>
      )}

      <AnimatePresence mode="wait">
        {step === "personal" && (
          <PersonalStep key="personal"
            name={name} setName={setName}
            age={age} setAge={setAge}
            city={city} setCity={setCity}
            job={job} setJob={setJob}
            academic={academic} setAcademic={setAcademic}
            motherLang={motherLang} setMotherLang={setMotherLang}
            otherLangs={otherLangs} setOtherLangs={setOtherLangs}
            purpose={purpose} setPurpose={setPurpose}
            gender={gender} setGender={setGender}
            selfCefr={selfCefr} setSelfCefr={setSelfCefr}
            saving={savingStep}
            onNext={() => void handlePersonalNext()}
          />
        )}
        {step === "interests" && (
          <InterestsStep key="interests"
            selected={selectedInterests}
            onToggle={toggleInterest}
            saving={savingStep}
            onNext={() => void handleInterestsNext()}
          />
        )}
        {step === "assessment" && (
          <AssessmentStep key="assessment"
            batch={batch}
            batchNum={batchNum}
            knownIds={knownIds}
            loading={loadingBatch}
            error={assessmentError}
            onToggle={toggleWord}
            onNext={() => void handleNextBatch()}
            onRetry={() => {
              setLoadingBatch(true);
              setAssessmentError(null);
              getAssessmentBatch(
                batchNum,
                selfCefr,
                [...allKnownIds].map((id) => allWordsSeen.find((w) => w.wordId === id)?.dutch ?? "").filter(Boolean),
                allWordsSeen.map((w) => w.dutch),
              )
                .then((res) => {
                  setBatch(res);
                  if (!hasAssessmentWords(res)) setAssessmentError(assessmentBatchError(res));
                })
                .finally(() => setLoadingBatch(false));
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "personal", label: "About you" },
    { key: "interests", label: "Interests" },
    { key: "assessment", label: "Word check" },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  const currentLabel = steps[idx]?.label ?? "";
  return (
    <div className="mb-7">
      <div className="flex items-center gap-2 sm:gap-3">
        {steps.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <div key={s.key} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none sm:gap-3">
              <div className="flex min-w-0 items-center gap-1.5">
                <motion.div
                  animate={{ backgroundColor: active ? "#0D7377" : done ? "#0D737740" : "#e7e5e4", scale: active ? 1.1 : 1 }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                >
                  {done
                    ? <Check size={11} strokeWidth={3} className="text-primary" />
                    : <span className="text-xs font-heading font-bold" style={{ color: active ? "#fff" : "#a8a29e" }}>{i + 1}</span>
                  }
                </motion.div>
                <span className="hidden truncate text-xs font-body font-semibold sm:inline" style={{ color: active ? "#0D7377" : "#a8a29e" }}>
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && <div className="h-px min-w-4 flex-1 bg-black/10" />}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs font-body font-semibold text-primary sm:hidden">
        Step {idx + 1}: {currentLabel}
      </p>
    </div>
  );
}

function PersonalStep(props: {
  name: string; setName: (v: string) => void;
  age: number | ""; setAge: (v: number | "") => void;
  city: string; setCity: (v: string) => void;
  job: string; setJob: (v: string) => void;
  academic: string; setAcademic: (v: string) => void;
  motherLang: string; setMotherLang: (v: string) => void;
  otherLangs: string; setOtherLangs: (v: string) => void;
  purpose: Purpose | ""; setPurpose: (v: Purpose | "") => void;
  gender: Gender | ""; setGender: (v: Gender | "") => void;
  selfCefr: string; setSelfCefr: (v: string) => void;
  saving: boolean;
  onNext: () => void;
}) {
  const [inputError, setInputError] = useState<string | null>(null);

  const canContinue =
    props.age !== "" &&
    props.city.trim().length > 0 &&
    props.job.trim().length > 0 &&
    props.academic.trim().length > 0 &&
    props.motherLang.trim().length > 0 &&
    props.purpose !== "" &&
    props.selfCefr !== "" &&
    !props.saving;

  const handleTextChange = (val: string, setter: (v: string) => void, fieldName: string) => {
    if (/\d/.test(val)) {
      setInputError(`Please use only letters for your ${fieldName}.`);
    } else {
      setInputError(null);
      setter(val);
    }
  };

  const handleAgeChange = (val: string) => {
    if (val !== "" && !/^\d+$/.test(val)) {
      setInputError("Please use only numbers for your age.");
    } else {
      setInputError(null);
      props.setAge(val === "" ? "" : Number(val));
    }
  };

  return (
    <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
      <h1 className="font-heading text-2xl font-bold text-text mb-1">Tell us about yourself</h1>
      <p className="text-sm text-text/50 font-body mb-6">
        These details shape the angle, level and vocabulary of your texts. You can change them later in Settings.
      </p>

      {inputError && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
          <AlertCircle size={16} className="text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700 font-body">{inputError}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Name"><input value={props.name} onChange={(e) => props.setName(e.target.value)} placeholder="e.g. Anna" className={inputCls} /></Field>
        <Field label="Age *"><input type="text" inputMode="numeric" value={props.age} onChange={(e) => handleAgeChange(e.target.value)} placeholder="e.g. 24" className={inputCls} /></Field>
        <Field label="City *"><input value={props.city} onChange={(e) => handleTextChange(e.target.value, props.setCity, "city name")} placeholder="e.g. Amsterdam" className={inputCls} /></Field>
        <Field label="Job / occupation *"><input value={props.job} onChange={(e) => handleTextChange(e.target.value, props.setJob, "job/occupation")} placeholder="e.g. Software engineer" className={inputCls} /></Field>
        <Field label="Academic background *"><input value={props.academic} onChange={(e) => handleTextChange(e.target.value, props.setAcademic, "academic background")} placeholder="e.g. BSc Computer Science" className={inputCls} /></Field>
        <Field label="Mother language *"><input value={props.motherLang} onChange={(e) => handleTextChange(e.target.value, props.setMotherLang, "mother language")} placeholder="e.g. Arabic" className={inputCls} /></Field>
        <Field label="Other languages"><input value={props.otherLangs} onChange={(e) => handleTextChange(e.target.value, props.setOtherLangs, "other languages")} placeholder="e.g. English, Spanish" className={inputCls} /></Field>
        <Field label="Purpose of learning Dutch *">
          <select value={props.purpose} onChange={(e) => props.setPurpose(e.target.value as Purpose | "")} className={inputCls}>
            <option value="">Select…</option>
            {PURPOSES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </select>
        </Field>
        <Field label="Your Dutch level (your estimate) *">
          <select value={props.selfCefr} onChange={(e) => props.setSelfCefr(e.target.value)} className={inputCls}>
            <option value="">Select...</option>
            {CEFR_LEVELS.map((l) => <option key={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Gender (optional)">
          <GenderSelect value={props.gender} onChange={props.setGender} />
        </Field>
      </div>

      <button type="button" onClick={props.onNext} disabled={!canContinue}
        className={["mt-7 w-full flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-heading font-semibold transition-all", canContinue ? "bg-primary text-white hover:opacity-90" : "bg-black/6 text-text/30 cursor-not-allowed"].join(" ")}>
        {props.saving ? "Saving…" : "Continue to Interests"} <ArrowRight size={16} strokeWidth={2.5} />
      </button>
    </motion.div>
  );
}

export function GenderSelect({ value, onChange }: { value: Gender | ""; onChange: (v: Gender | "") => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Gender | "")} className={inputCls} aria-label="Gender">
      <option value="">Select…</option>
      {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
    </select>
  );
}

function InterestsStep({ selected, onToggle, onNext, saving }: {
  selected: Set<InterestId>;
  onToggle: (id: InterestId) => void;
  onNext: () => void;
  saving: boolean;
}) {
  const canContinue = selected.size >= MIN_INTERESTS && !saving;
  return (
    <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
      <h1 className="font-heading text-2xl font-bold text-text mb-1">What are you interested in?</h1>
      <p className="text-sm text-text/50 font-body mb-6">
        Your texts and new words are chosen around these topics. Pick {MIN_INTERESTS} to {MAX_INTERESTS}.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {INTERESTS.map((interest) => {
          const isSelected = selected.has(interest.id);
          const atMax = selected.size >= MAX_INTERESTS && !isSelected;
          const Icon = interest.icon;
          return (
            <button key={interest.id} type="button" onClick={() => !atMax && onToggle(interest.id)}
              disabled={atMax}
              className={["relative flex flex-col items-center gap-2.5 rounded-xl border-2 px-3 py-4 text-center select-none transition-colors duration-150",
                isSelected ? "border-primary bg-primary/6 shadow-sm" : atMax ? "border-black/8 bg-black/[0.02] opacity-40 cursor-not-allowed" : "border-black/10 bg-white hover:border-black/20 cursor-pointer"].join(" ")}
              style={isSelected ? { borderColor: interest.color, backgroundColor: `${interest.color}0f` } : {}}>
              {isSelected && (
                <span className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: interest.color }}>
                  <Check size={9} strokeWidth={3} className="text-white" />
                </span>
              )}
              <div className="flex items-center justify-center w-10 h-10 rounded-xl" style={{ backgroundColor: isSelected ? `${interest.color}20` : "#f5f5f4" }}>
                <Icon size={20} strokeWidth={1.8} style={{ color: isSelected ? interest.color : "#a8a29e" }} />
              </div>
              <span className="text-xs font-body font-semibold leading-tight" style={{ color: isSelected ? interest.color : "#78716c" }}>
                {interest.label}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" onClick={onNext} disabled={!canContinue}
        className={["mt-7 w-full flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-heading font-semibold transition-all", canContinue ? "bg-primary text-white hover:opacity-90" : "bg-black/6 text-text/30 cursor-not-allowed"].join(" ")}>
        {saving ? "Saving…" : "Continue to Word Check"} <ArrowRight size={16} strokeWidth={2.5} />
      </button>
    </motion.div>
  );
}

function AssessmentStep({ batch, batchNum, knownIds, loading, error, onToggle, onNext, onRetry }: {
  batch: BatchResult | null;
  batchNum: number; knownIds: Set<string>; loading: boolean;
  error: string | null;
  onToggle: (id: string) => void; onNext: () => void; onRetry: () => void;
}) {
  const words = batch?.success ? batch.data.words.filter((w) => !w.isPseudo) : [];
  const isEmpty = !loading && words.length === 0;
  return (
    <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-heading text-2xl font-bold text-text">Word check</h1>
        <span className="text-xs font-body text-text/40">Batch {batchNum} of {TOTAL_BATCHES}</span>
      </div>
      <p className="text-sm text-text/50 font-body mb-5">
        Select only words you understand without help. This sets your starting level and marks those words as known.
      </p>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Hourglass size={32} className="text-primary animate-pulse mb-4" />
          <p className="text-sm font-body text-text/60 font-medium mb-6 animate-pulse">
            Preparing words around your level...
          </p>
          <div className="flex flex-wrap gap-2.5 justify-center opacity-40">
            {Array.from({ length: 15 }).map((_, i) => (
              <div key={i} className="h-8 rounded-full bg-black/10 animate-pulse" style={{ width: `${60 + (i % 5) * 18}px` }} />
            ))}
          </div>
        </div>
      ) : isEmpty ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
          <div className="flex gap-3">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-body font-semibold text-amber-800">This word check did not load correctly.</p>
              <p className="mt-1 text-sm font-body text-amber-700">{error ?? "Please try loading the words again."}</p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-heading font-semibold text-amber-800 hover:bg-amber-100"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2.5 max-h-72 overflow-y-auto pr-1">
          {words.map((w) => {
            const known = knownIds.has(w.wordId);
            return (
              <button key={w.wordId} type="button" onClick={() => onToggle(w.wordId)}
                className={["flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-body font-medium border transition-all select-none",
                  known ? "bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm" : "bg-black/[0.025] border-black/10 text-text/60 hover:border-black/20 hover:bg-black/[0.04]"].join(" ")}>
                {known && <Check size={12} strokeWidth={3} className="text-emerald-600" />}
                {w.dutch}
              </button>
            );
          })}
        </div>
      )}

      {error && !isEmpty && (
        <p className="mt-3 text-xs font-body text-red-600">{error}</p>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <button type="button" onClick={onNext} disabled={loading || isEmpty}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-heading font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {batchNum < TOTAL_BATCHES ? "Next batch" : "See my results"} <ArrowRight size={16} />
        </button>
      </div>
    </motion.div>
  );
}

function hasAssessmentWords(res: BatchResult) {
  return res.success && res.data.words.some((word) => !word.isPseudo);
}

function assessmentBatchError(res: BatchResult) {
  return res.success ? "Could not load this word check. Please try again." : res.error;
}

export const inputCls =
  "w-full rounded-xl border border-black/12 bg-black/[0.02] px-3.5 py-2.5 text-sm font-body text-text placeholder:text-text/30 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-body font-semibold text-text/60 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}
