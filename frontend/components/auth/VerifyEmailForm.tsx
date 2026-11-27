"use client";

import { motion } from "framer-motion";
import { ArrowRight, LoaderCircle, Mail, RotateCw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import { apiPost } from "@/lib/api";
import { ErrorText } from "./fields";

const LENGTH = 6;
const RESEND_SECONDS = 30;

/**
 * Email verification step after sign-up. Checks the emailed 6-digit code via
 * `POST /api/auth/verify-email`; "resend" asks the backend for a fresh code.
 */
export function VerifyEmailForm() {
  const email = useSearchParams().get("email") || null;

  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(() => Array(LENGTH).fill(""));
  const [error, setError] = useState<string>();
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const [resent, setResent] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Coming back to this page (Back button, or the browser's back/forward cache) must
  // show a fresh, usable form — never the old code stuck on "Verifying…".
  useEffect(() => {
    const reset = () => {
      setVerifying(false);
      setDigits(Array(LENGTH).fill(""));
    };
    const onShow = (e: PageTransitionEvent) => e.persisted && reset();
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const focus = (i: number) => inputs.current[Math.max(0, Math.min(LENGTH - 1, i))]?.focus();

  const fill = (start: number, value: string) => {
    const chars = value.replace(/\D/g, "").slice(0, LENGTH - start).split("");
    if (!chars.length) return;
    setDigits((d) => {
      const next = [...d];
      chars.forEach((c, k) => (next[start + k] = c));
      return next;
    });
    setError(undefined);
    focus(start + chars.length);
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      setDigits((d) => d.map((v, k) => (k === i - 1 ? "" : v)));
      focus(i - 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focus(i + 1);
    }
  };

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    fill(i, e.clipboardData.getData("text"));
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (verifying) return;
    if (digits.some((d) => !d)) {
      setError(`Enter all ${LENGTH} digits from the email.`);
      focus(digits.findIndex((d) => !d));
      return;
    }
    if (!email) {
      setError("We lost track of your email. Go back and sign up again.");
      return;
    }
    setVerifying(true);
    try {
      await apiPost("/api/auth/verify-email", { email, code: digits.join("") });
      // replace, not push: the used code page shouldn't sit in history to go "back" to.
      router.replace("/verify-email/success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setTimeout(() => focus(0));
    } finally {
      // Always unlock and clear the form, success or not, so a kept/restored page is never stuck.
      setVerifying(false);
      setDigits(Array(LENGTH).fill(""));
    }
  };

  const resend = async () => {
    if (!email) return;
    setError(undefined);
    setResent(false);
    setCooldown(RESEND_SECONDS);
    try {
      await apiPost("/api/auth/resend-verification", { email });
      setResent(true);
      setDigits(Array(LENGTH).fill(""));
      focus(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send a new code.");
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <div className="flex items-start gap-3 border-2 border-ink bg-paper p-4 text-ink shadow-pixel-sm">
        <Mail className="mt-0.5 size-5 shrink-0 text-forest" aria-hidden />
        <p className="text-sm">
          We sent a {LENGTH}-digit code to{" "}
          {email ? <strong className="break-all font-semibold">{email}</strong> : "your email address"}. It expires in 10
          minutes.
        </p>
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-ink">Verification code</legend>
        <div className="grid grid-cols-6 gap-2 sm:gap-3">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                inputs.current[i] = el;
              }}
              type="text"
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              pattern="[0-9]*"
              maxLength={LENGTH}
              aria-label={`Digit ${i + 1} of ${LENGTH}`}
              aria-invalid={!!error && !d}
              aria-describedby={error ? "code-error" : undefined}
              value={d}
              disabled={verifying}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                if (!v) {
                  setDigits((p) => p.map((x, k) => (k === i ? "" : x)));
                  return;
                }
                fill(i, v);
              }}
              onKeyDown={(e) => onKeyDown(i, e)}
              onPaste={(e) => onPaste(i, e)}
              onFocus={(e) => e.target.select()}
              className="aspect-square w-full min-w-0 border-2 border-ink bg-paper-light text-center font-pixel text-xl text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dashed focus-visible:outline-forest disabled:opacity-60 aria-[invalid=true]:border-terracotta sm:text-2xl"
            />
          ))}
        </div>
        {error && <ErrorText id="code-error">{error}</ErrorText>}
      </fieldset>

      <motion.button
        type="submit"
        disabled={verifying}
        whileHover={verifying ? undefined : { y: -2 }}
        whileTap={verifying ? undefined : { y: 1 }}
        className="group inline-flex w-full items-center justify-center gap-2 border-2 border-ink bg-forest px-5 py-3.5 font-semibold text-paper shadow-pixel disabled:cursor-wait disabled:opacity-80"
      >
        {verifying ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            Verifying…
          </>
        ) : (
          <>
            Verify email
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
          </>
        )}
      </motion.button>

      <div className="flex flex-col items-center gap-1 text-sm text-ink/80">
        <p>
          Didn&apos;t get it? Check your spam folder, or{" "}
          {cooldown > 0 ? (
            <span className="font-mono text-muted">resend in {cooldown}s</span>
          ) : (
            <button
              type="button"
              onClick={resend}
              className="inline-flex items-center gap-1 font-semibold text-forest underline decoration-2 underline-offset-2 hover:text-terracotta"
            >
              <RotateCw className="size-3.5" aria-hidden />
              resend the code
            </button>
          )}
        </p>
        <p role="status" className="font-mono text-xs text-forest">
          {resent && cooldown > 0 ? "A fresh code is on its way." : ""}
        </p>
      </div>
    </form>
  );
}
