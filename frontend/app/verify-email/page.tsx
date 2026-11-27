import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLink, AuthShell } from "@/components/auth/AuthShell";
import { VerifyEmailForm } from "@/components/auth/VerifyEmailForm";
import { BRAND } from "@/components/landing/brand";
import { WorkspaceScene } from "@/components/scene/SpaceScenes";

export const metadata: Metadata = {
  title: `Verify your email — ${BRAND.name}`,
  description: `Confirm your email to finish setting up your ${BRAND.name} account.`,
};

export default function VerifyEmailPage() {
  return (
    <AuthShell
      status="Mail is on its way"
      heading={
        <>
          One quick <span className="text-sun">knock</span> on the door.
        </>
      }
      blurb="We just need to make sure it’s really you before we hand over the keys to your desk."
      scenes={[<WorkspaceScene key="workspace" />]}
      title="Check your inbox"
      subtitle="Enter the code we emailed you to verify your account."
      fit
      footer={
        <>
          Wrong email? <AuthLink href="/signup">Go back and change it</AuthLink>
        </>
      }
    >
      <Suspense fallback={<div className="h-80" aria-hidden />}>
        <VerifyEmailForm />
      </Suspense>
    </AuthShell>
  );
}
