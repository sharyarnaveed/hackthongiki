import Link from "next/link";
import { Construction } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { Button } from "@/components/ui/button";

/** Temporary placeholder for routes built in later steps. */
export function ComingSoon({ title, step }: { title: string; step: number }) {
  return (
    <div className="grid h-full place-items-center">
      <EmptyState
        icon={Construction}
        title={title}
        description={`This screen is built in step ${step}.`}
        action={<Button asChild size="sm" variant="outline"><Link href="/dev/components">View components</Link></Button>}
      />
    </div>
  );
}
