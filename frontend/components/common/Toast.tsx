"use client";

import { CircleCheck, Info, Loader2, OctagonX, TriangleAlert } from "lucide-react";
import { Toaster as Sonner, toast } from "sonner";
import { useResolvedDark } from "@/components/shell/ThemeProvider";
import { useMode } from "@/lib/hooks/useMode";

/** App-wide toaster, themed per mode. Use `toast()` from this module. */
export function Toaster() {
  const dark = useResolvedDark();
  const mode = useMode();
  const home = mode === "home";
  return (
    <Sonner
      theme={dark ? "dark" : "light"}
      position="bottom-right"
      offset={16}
      icons={{
        success: <CircleCheck className="size-4 text-success" />,
        info: <Info className="size-4 text-info" />,
        warning: <TriangleAlert className="size-4 text-warning" />,
        error: <OctagonX className="size-4 text-destructive" />,
        loading: <Loader2 className="size-4 animate-spin" />,
      }}
      toastOptions={{
        className: home ? "!font-pixel !text-[9px] !leading-relaxed" : "!text-[13px]",
        style: home
          ? {
              borderRadius: 0,
              border: 0,
              boxShadow:
                "0 -4px 0 0 var(--pixel-border-color),0 4px 0 0 var(--pixel-border-color),-4px 0 0 0 var(--pixel-border-color),4px 0 0 0 var(--pixel-border-color),8px 8px 0 0 var(--pixel-shadow-color)",
            }
          : undefined,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
    />
  );
}

export { toast };
