"use client";

import Link from "next/link";
import { Minus, Square, X } from "lucide-react";
import { ModeSwitcher } from "./ModeSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "@/lib/utils";

/** Electron preload can expose this; in the browser the buttons are no-ops. */
type WindowBridge = { minimize?: () => void; maximize?: () => void; close?: () => void };
const bridge = (): WindowBridge | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { vo?: WindowBridge }).vo;

/**
 * Custom 36px title bar. The whole bar is a drag region for a frameless
 * Electron window; interactive children opt out with `.no-drag`.
 */
export function TitleBar({ showModeSwitcher = true }: { showModeSwitcher?: boolean }) {
  return (
    <header
      className={cn(
        "drag-region relative z-50 flex h-9 shrink-0 items-center gap-3 border-b bg-titlebar px-3",
        "home:border-b-0 home:shadow-[0_4px_0_0_var(--pixel-border-color)]",
      )}
    >
      <Link href="/" className="no-drag flex items-center gap-2">
        <span className="grid size-5 place-items-center bg-primary text-[10px] font-bold text-primary-foreground office:rounded home:font-pixel home:text-[8px]">
          VO
        </span>
        <span className="text-[13px] font-semibold tracking-tight home:font-pixel home:text-[9px]">
          Virtual Office
        </span>
      </Link>

      <div className="flex-1" />

      {showModeSwitcher && <ModeSwitcher navigate />}
      <ThemeToggle />

      <div className="no-drag -mr-1 flex items-center">
        <WinButton label="Minimize" onClick={() => bridge()?.minimize?.()}><Minus /></WinButton>
        <WinButton label="Maximize" onClick={() => bridge()?.maximize?.()}><Square className="size-3" /></WinButton>
        <WinButton label="Close" danger onClick={() => bridge()?.close?.()}><X /></WinButton>
      </div>
    </header>
  );
}

function WinButton({ children, label, danger, onClick }: { children: React.ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={cn(
        "grid h-9 w-10 place-items-center text-muted-foreground transition-colors [&_svg]:size-3.5",
        danger ? "hover:bg-destructive hover:text-white" : "hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
