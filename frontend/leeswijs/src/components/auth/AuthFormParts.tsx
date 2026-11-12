import { AlertCircle } from "lucide-react";
import { motion } from "framer-motion";

export function Field({ label, error, htmlFor, hint, children }: {
  label: string;
  error?: string | null;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-body font-semibold text-text/60 uppercase tracking-wide">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-text/35 font-body">{hint}</p>}
      {error && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-red-500 font-body flex items-center gap-1"
        >
          <AlertCircle size={11} />
          {error}
        </motion.p>
      )}
    </div>
  );
}

export function InputWrapper({ icon, hasError, children }: {
  icon: React.ReactNode;
  hasError: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={[
      "flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors",
      "focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50",
      hasError ? "border-red-300 bg-red-50/40" : "border-black/12 bg-black/[0.02] hover:border-black/20",
    ].join(" ")}>
      <span className={hasError ? "text-red-400" : "text-text/30"}>{icon}</span>
      {children}
    </div>
  );
}

export function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="relative my-6">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-black/8" />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-white px-3 text-xs text-text/35 font-body">{label}</span>
      </div>
    </div>
  );
}

export const inputClass =
  "flex-1 bg-transparent text-sm font-body text-text placeholder:text-text/30 outline-none";

export function validateEmail(value: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim()) ? null : "Enter a valid email address.";
}

export function validateNewPassword(value: string) {
  return value.length >= 8 ? null : "Use at least 8 characters.";
}
