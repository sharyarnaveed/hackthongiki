"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, apiPost } from "@/lib/api";

/** Early-access sign-up, saved to the waitlist on the server. */
export function EarlyAccessForm() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (sending) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("That email doesn't look quite right.");
      return;
    }
    setError("");
    setSending(true);
    try {
      await apiPost("/api/waitlist", { email: email.trim() });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-10 max-w-lg">
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.p
            key="done"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 border-2 border-ink bg-sun p-4 text-ink shadow-pixel"
            role="status"
          >
            <Check className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>
              <strong className="font-semibold">You&rsquo;re on the list.</strong> We&rsquo;ll save you a desk by the window.
            </span>
          </motion.p>
        ) : (
          <motion.form key="form" onSubmit={submit} noValidate exit={{ opacity: 0, y: -8 }} className="flex flex-col gap-3 sm:flex-row">
            <label htmlFor="early-email" className="sr-only">
              Work email
            </label>
            <input
              id="early-email"
              type="email"
              autoComplete="email"
              placeholder="you@yourteam.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? "early-email-error" : undefined}
              className="min-w-0 flex-1 border-2 border-ink bg-paper-light px-4 py-3.5 text-ink placeholder:text-muted focus:outline-none focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-sun"
            />
            <motion.button
              type="submit"
              disabled={sending}
              aria-busy={sending}
              whileHover={{ y: -2 }}
              whileTap={{ y: 1 }}
              className="group inline-flex items-center justify-center gap-2 border-2 border-ink bg-sun px-5 py-3.5 font-semibold text-ink shadow-[4px_4px_0_0_var(--color-ink)]"
            >
              {sending ? "Saving…" : "Get early access"}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
            </motion.button>
          </motion.form>
        )}
      </AnimatePresence>
      {error && (
        <p id="early-email-error" className="mt-2 font-mono text-sm text-terracotta" role="alert">
          {error}
        </p>
      )}
      <p className="mt-4 font-mono text-xs text-paper/60">Free while in early access · Small teams first · No spam, ever</p>
    </div>
  );
}
