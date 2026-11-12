import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, Lock, Eye, EyeOff, ArrowRight, UserRound } from "lucide-react";

import { googleSignIn, register } from "../services/api";
import { useStore } from "../store";
import ErrorBanner from "../components/ErrorBanner";
import GoogleSignInButton, { isGoogleSignInEnabled } from "../components/auth/GoogleSignInButton";
import {
  Divider, Field, InputWrapper, Spinner, inputClass, validateEmail, validateNewPassword,
} from "../components/auth/AuthFormParts";
import { easeOut } from "../constants/animation";
import type { User } from "../types";

function validateConfirm(password: string, confirm: string) {
  return password === confirm ? null : "Passwords do not match.";
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useStore((s) => s.setAuth);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false, confirm: false });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const emailError = touched.email ? validateEmail(email) : null;
  const passwordError = touched.password ? validateNewPassword(password) : null;
  const confirmError = touched.confirm ? validateConfirm(password, confirm) : null;
  const isFormValid =
    !validateEmail(email) && !validateNewPassword(password) && !validateConfirm(password, confirm);

  function finish(user: User, token: string) {
    setAuth(user, token);
    navigate(user.onboarding_completed ? "/home" : "/onboarding", { replace: true });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ email: true, password: true, confirm: true });
    if (!isFormValid) return;

    setSubmitting(true);
    setServerError(null);
    try {
      const { user, token } = await register(email.trim(), password, name.trim() || undefined);
      finish(user, token);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  const handleGoogle = useCallback(async (credential: string) => {
    setSubmitting(true);
    setServerError(null);
    try {
      const { user, token } = await googleSignIn(credential);
      finish(user, token);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: easeOut }}
      className="bg-white rounded-2xl shadow-xl shadow-black/8 px-8 py-9"
    >
      <div className="mb-7">
        <h1 className="font-heading text-2xl font-bold text-text">Create your account</h1>
        <p className="mt-1 text-sm text-text/50 font-body">
          Read Dutch texts about the things you care about, at your level.
        </p>
      </div>

      {serverError && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mb-5">
          <ErrorBanner message={serverError} />
        </motion.div>
      )}

      {isGoogleSignInEnabled() && (
        <>
          <GoogleSignInButton text="signup_with" onCredential={(c) => void handleGoogle(c)} />
          <Divider label="or sign up with email" />
        </>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field label="Name (optional)" htmlFor="register-name">
          <InputWrapper icon={<UserRound size={16} />} hasError={false}>
            <input
              id="register-name"
              type="text"
              autoComplete="name"
              placeholder="How should we call you?"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </InputWrapper>
        </Field>

        <Field label="Email" error={emailError} htmlFor="register-email">
          <InputWrapper icon={<Mail size={16} />} hasError={!!emailError}>
            <input
              id="register-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              className={inputClass}
            />
          </InputWrapper>
        </Field>

        <Field label="Password" error={passwordError} htmlFor="register-password" hint="At least 8 characters.">
          <InputWrapper icon={<Lock size={16} />} hasError={!!passwordError}>
            <input
              id="register-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Create a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              className={inputClass}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="text-text/30 hover:text-text/60 transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </InputWrapper>
        </Field>

        <Field label="Confirm password" error={confirmError} htmlFor="register-confirm">
          <InputWrapper icon={<Lock size={16} />} hasError={!!confirmError}>
            <input
              id="register-confirm"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Repeat your password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
              className={inputClass}
            />
          </InputWrapper>
        </Field>

        <motion.button
          type="submit"
          disabled={submitting}
          whileTap={{ scale: submitting ? 1 : 0.97 }}
          className={[
            "mt-2 w-full flex items-center justify-center gap-2",
            "rounded-xl px-5 py-3 text-sm font-heading font-semibold text-white",
            "bg-primary transition-opacity",
            submitting ? "opacity-60 cursor-not-allowed" : "hover:opacity-90",
          ].join(" ")}
        >
          {submitting ? <Spinner /> : <>Create account<ArrowRight size={16} strokeWidth={2.5} /></>}
        </motion.button>
      </form>

      <Divider label="Already have an account?" />

      <Link
        to="/login"
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-black/12 px-5 py-2.5 text-sm font-body font-semibold text-text/70 hover:bg-black/[0.03] hover:text-text transition-colors"
      >
        Log in
      </Link>
    </motion.div>
  );
}
