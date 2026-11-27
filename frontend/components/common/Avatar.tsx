"use client";

import { Avatar as AvatarRoot, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Presence, User } from "@/lib/types";
import { cn } from "@/lib/utils";

const SIZES = {
  xs: { box: "size-6", text: "text-[10px]", dot: "size-2 ring-[1.5px]" },
  sm: { box: "size-8", text: "text-xs", dot: "size-2.5 ring-2" },
  md: { box: "size-10", text: "text-sm", dot: "size-3 ring-2" },
  lg: { box: "size-14", text: "text-lg", dot: "size-3.5 ring-[3px]" },
  xl: { box: "size-20", text: "text-2xl", dot: "size-4 ring-[3px]" },
} as const;

const STATUS_BG: Record<Presence, string> = {
  online: "bg-status-online",
  busy: "bg-status-busy",
  away: "bg-status-away",
  offline: "bg-status-offline",
};

export const STATUS_LABEL: Record<Presence, string> = {
  online: "Online",
  busy: "Busy",
  away: "Away",
  offline: "Offline",
};

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

export interface AvatarProps {
  user: Pick<User, "name" | "color"> & Partial<Pick<User, "avatarUrl" | "status">>;
  size?: keyof typeof SIZES;
  showStatus?: boolean;
  /** highlight ring, e.g. active speaker */
  ring?: boolean;
  className?: string;
}

export function Avatar({ user, size = "sm", showStatus = true, ring, className }: AvatarProps) {
  const s = SIZES[size];
  const status = user.status ?? "offline";
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <AvatarRoot
        className={cn(
          s.box,
          "home:rounded-none",
          ring && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
      >
        {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
        <AvatarFallback
          className={cn(s.text, "font-semibold text-white home:rounded-none home:font-pixel home:text-[0.6em]")}
          style={{ background: user.color }}
        >
          {initials(user.name)}
        </AvatarFallback>
      </AvatarRoot>
      {showStatus && (
        <span
          role="img"
          aria-label={STATUS_LABEL[status]}
          title={STATUS_LABEL[status]}
          className={cn(
            "absolute right-0 bottom-0 rounded-full ring-background home:rounded-none",
            s.dot,
            STATUS_BG[status],
          )}
        />
      )}
    </span>
  );
}

export function StatusDot({ status, className }: { status: Presence; className?: string }) {
  return (
    <span
      aria-label={STATUS_LABEL[status]}
      className={cn("inline-block size-2 rounded-full home:rounded-none", STATUS_BG[status], className)}
    />
  );
}
