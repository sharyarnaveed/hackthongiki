"use client";

import { motion } from "framer-motion";
import { Building2, Home } from "lucide-react";
import { useRouter } from "next/navigation";
import { useUI } from "@/stores/ui";
import type { Mode } from "@/lib/types";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Mode; label: string; icon: typeof Home; href: string }[] = [
  { value: "office", label: "Office", icon: Building2, href: "/office" },
  { value: "home", label: "Home", icon: Home, href: "/home" },
];

interface Props {
  /** navigate to the mode's root route after switching */
  navigate?: boolean;
  className?: string;
}

export function ModeSwitcher({ navigate = false, className }: Props) {
  const mode = useUI((s) => s.mode);
  const setMode = useUI((s) => s.setMode);
  const router = useRouter();

  return (
    <div
      role="radiogroup"
      aria-label="App mode"
      className={cn(
        "no-drag relative inline-flex items-center gap-0.5 bg-muted p-0.5 text-xs",
        "office:rounded-md home:pixel-border-flat home:m-1",
        className,
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon, href }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            onClick={() => {
              setMode(value);
              if (navigate) router.push(href);
            }}
            className={cn(
              "relative z-10 inline-flex h-6 items-center gap-1.5 px-2.5 font-medium transition-colors",
              "office:rounded-[5px] home:font-pixel home:text-[8px] home:uppercase",
              active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="mode-pill"
                className="absolute inset-0 -z-10 bg-primary office:rounded-[5px]"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <Icon className="size-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
