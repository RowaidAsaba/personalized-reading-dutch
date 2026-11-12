import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";

import { googleSignIn, login } from "../services/api";
import { useStore } from "../store";
import ErrorBanner from "../components/ErrorBanner";
import GoogleSignInButton, { isGoogleSignInEnabled } from "../components/auth/GoogleSignInButton";
import { Divider, Field, InputWrapper, Spinner, inputClass, validateEmail } from "../components/auth/AuthFormParts";
import { easeOut } from "../constants/animation";
import type { User } from "../types";

function validatePassword(value: string) {
  return value.length > 0 ? null : "Enter your password.";
}

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useStore((s) => s.setAuth);
  const setLoadingUser = useStore((s) => s.setLoadingUser);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const emailError = touched.email ? validateEmail(email) : null;
  const passwordError = touched.password ? validatePassword(password) : null;
  const isFormValid = !validateEmail(email) && !validatePassword(password);

  function finish(user: User, token: string) {
    setAuth(user, token);
    navigate(user.onboarding_completed ? "/home" : "/onboarding", { replace: true });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (!isFormValid) return;

    setSubmitting(true);
    setServerError(null);
    setLoadingUser(true);
    try {
      const { user, token } = await login(email.trim(), password);
      finish(user, token);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
      setLoadingUser(false);
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
        <h1 className="font-heading text-2xl font-bold text-text">Welcome back</h1>
        <p className="mt-1 text-sm text-text/50 font-body">
          Log in to continue reading Dutch texts made for you.
        </p>
      </div>

      {serverError && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mb-5">
          <ErrorBanner message={serverError} />
        </motion.div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field label="Email" error={emailError} htmlFor="login-email">
          <InputWrapper icon={<Mail size={16} />} hasError={!!emailError}>
            <input
              id="login-email"
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

        <Field label="Password" error={passwordError} htmlFor="login-password">
          <InputWrapper icon={<Lock size={16} />} hasError={!!passwordError}>
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
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
          {submitting ? <Spinner /> : <>Log in<ArrowRight size={16} strokeWidth={2.5} /></>}
        </motion.button>
      </form>

      {isGoogleSignInEnabled() && (
        <>
          <Divider label="or" />
          <GoogleSignInButton text="continue_with" onCredential={(c) => void handleGoogle(c)} />
        </>
      )}

      <Divider label="New to LeesWijs?" />

      <Link
        to="/register"
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-black/12 px-5 py-2.5 text-sm font-body font-semibold text-text/70 hover:bg-black/[0.03] hover:text-text transition-colors"
      >
        Create an account
      </Link>
    </motion.div>
  );
}
