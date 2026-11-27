"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, apiPost } from "@/lib/api";
import { ErrorText, Field, PasswordField } from "./fields";

type Fields = { email: string; password: string; remember: boolean };
type Errors = Partial<Record<keyof Fields, string>>;

function validate(f: Fields): Errors {
  const e: Errors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = "That email doesn't look quite right.";
  if (!f.password) e.password = "Enter your password.";
  return e;
}

/** Only same-site paths are allowed as a post-sign-in destination (no open redirects). */
function nextPath() {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

/** Account sign-in. On success the backend sets an HttpOnly session cookie. */
export function SignInForm() {
  const [fields, setFields] = useState<Fields>({ email: "", password: "", remember: true });
  const [errors, setErrors] = useState<Errors>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const router = useRouter();

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => {
    setFields((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next = validate(fields);
    setErrors(next);
    if (Object.keys(next).length || busy) return;
    setBusy(true);
    setFormError(null);
    const email = fields.email.trim().toLowerCase();
    try {
      await apiPost("/api/auth/signin", { email, password: fields.password, remember: fields.remember });
      setDone(true);
      router.replace(nextPath());
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      if (apiErr?.data.needsVerification) {
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }
      setFormError(apiErr?.message ?? "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {done ? (
        <motion.div
          key="done"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 border-2 border-ink bg-sun p-4 text-ink shadow-pixel"
          role="status"
        >
          <Check className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>
            <strong className="font-semibold">You&rsquo;re in.</strong> Walking you to your desk&hellip;
          </p>
        </motion.div>
      ) : (
        <motion.form key="form" onSubmit={submit} noValidate exit={{ opacity: 0, y: -8 }} className="flex flex-col gap-4">
          <Field
            id="email"
            label="Email address"
            type="email"
            autoComplete="email"
            placeholder="you@yourteam.com"
            value={fields.email}
            onChange={(e) => set("email", e.target.value)}
            error={errors.email}
          />
          <PasswordField
            id="password"
            label="Password"
            autoComplete="current-password"
            placeholder="Your password"
            value={fields.password}
            onChange={(e) => set("password", e.target.value)}
            error={errors.password}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <label htmlFor="remember" className="flex cursor-pointer items-center gap-3 text-ink/80">
              <input
                id="remember"
                type="checkbox"
                checked={fields.remember}
                onChange={(e) => set("remember", e.target.checked)}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="grid size-5 shrink-0 place-items-center border-2 border-ink bg-paper-light text-ink transition-colors peer-checked:bg-sun peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-dashed peer-focus-visible:outline-forest [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100"
              >
                <Check className="size-3.5" strokeWidth={3} />
              </span>
              Remember me
            </label>
            <a href="#" className="font-semibold text-forest underline decoration-2 underline-offset-2 hover:text-terracotta">
              Forgot password?
            </a>
          </div>

          {formError && <ErrorText id="signin-error">{formError}</ErrorText>}

          <motion.button
            type="submit"
            disabled={busy}
            whileHover={{ y: -2 }}
            whileTap={{ y: 1 }}
            className="group mt-2 inline-flex w-full items-center justify-center gap-2 border-2 border-ink bg-forest px-5 py-3.5 font-semibold text-paper shadow-pixel"
          >
            {busy ? "Signing in…" : "Sign in"}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
          </motion.button>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
