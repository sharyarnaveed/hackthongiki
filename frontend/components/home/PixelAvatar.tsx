"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";
import { PixelSprite } from "@/components/common/PixelSprite";
import { avatarSprite, COUPLE_LOOKS, lookFor, type AvatarLook } from "@/lib/pixel/sprites";
import type { Presence } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  userId: string;
  name?: string;
  look?: AvatarLook;
  scale?: number;
  /** idle bobbing animation */
  idle?: boolean;
  /** face left by mirroring */
  flip?: boolean;
  showName?: boolean;
  status?: Presence;
  speaking?: boolean;
  className?: string;
}

export function PixelAvatar({
  userId, name, look, scale = 4, idle = true, flip, showName, status, speaking, className,
}: Props) {
  const sprite = useMemo(() => avatarSprite(look ?? COUPLE_LOOKS[userId] ?? lookFor(userId)), [look, userId]);
  return (
    <div className={cn("relative inline-flex flex-col items-center", className)}>
      {speaking && (
        <motion.span
          className="absolute -top-3 font-pixel text-[8px] text-primary"
          animate={{ opacity: [0, 1, 0], y: [2, -2, -4] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        >
          ♪
        </motion.span>
      )}
      <div className={cn(idle && "animate-bob", flip && "-scale-x-100")}>
        <PixelSprite sprite={sprite} scale={scale} title={name} />
      </div>
      {/* soft pixel shadow */}
      <span
        aria-hidden
        className="-mt-0.5 block bg-black/20"
        style={{ width: sprite.w * scale * 0.6, height: scale }}
      />
      {showName && name && (
        <span className="mt-1 flex items-center gap-1 bg-card px-1.5 py-0.5 font-pixel text-[7px] whitespace-nowrap text-card-foreground shadow-[0_0_0_2px_var(--pixel-border-color)]">
          {status && (
            <span
              className={cn(
                "inline-block size-1.5",
                status === "online" && "bg-status-online",
                status === "busy" && "bg-status-busy",
                status === "away" && "bg-status-away",
                status === "offline" && "bg-status-offline",
              )}
            />
          )}
          {name}
        </span>
      )}
    </div>
  );
}
