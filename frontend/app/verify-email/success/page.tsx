import type { Metadata } from "next";
import { ArrowRight, BadgeCheck } from "lucide-react";
import Link from "next/link";
import { AuthLink, AuthShell } from "@/components/auth/AuthShell";
import { BRAND } from "@/components/landing/brand";
import { LoungeScene, QuietCornerScene } from "@/components/scene/SpaceScenes";

export const metadata: Metadata = {
  title: `Email verified — ${BRAND.name}`,
  description: `Your ${BRAND.name} email is verified. Your desk is ready.`,
};

export default function VerifyEmailSuccessPage() {
  return (
    <AuthShell
      status="Keys handed over"
      heading={
        <>
          You’re <span className="text-sun">in</span>. Make yourself at home.
        </>
      }
      blurb="Your account is confirmed. The kettle’s on and your teammates are saving you a seat."
      scenes={[<LoungeScene key="lounge" />, <QuietCornerScene key="quiet" />]}
      title="Email verified"
      subtitle="Thanks for confirming. Your account is all set."
      fit
      footer={
        <>
          Want to come back later? <AuthLink href="/signin">Sign in</AuthLink>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <div role="status" className="flex items-start gap-3 border-2 border-ink bg-sun p-4 text-ink shadow-pixel">
          <BadgeCheck className="mt-0.5 size-6 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Verification complete</p>
            <p className="mt-1 text-sm text-ink/80">
              Your desk by the window is ready. Pick a layout, invite your team, and you’re good to go.
            </p>
          </div>
        </div>

        <ul className="flex flex-col gap-2 font-mono text-sm text-ink/80">
          <li>✓ Account created</li>
          <li>✓ Email confirmed</li>
          <li className="text-muted">○ Set up your office</li>
        </ul>

        <Link
          href="/dashboard"
          className="group inline-flex w-full items-center justify-center gap-2 border-2 border-ink bg-forest px-5 py-3.5 font-semibold text-paper shadow-pixel transition-transform hover:-translate-y-0.5 active:translate-y-px"
        >
          Go to your dashboard
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
        </Link>
      </div>
    </AuthShell>
  );
}
