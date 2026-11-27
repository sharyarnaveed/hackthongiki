"use client";

import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  side?: "left" | "right" | "bottom" | "top";
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /** keep page interactive behind the drawer (e.g. chat during a movie) */
  modal?: boolean;
}

export function Drawer({
  open, onOpenChange, title, description, side = "right", children, footer, className, modal = true,
}: DrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={modal}>
      <SheetContent side={side} className={cn("flex flex-col gap-0 p-0", className)}>
        <SheetHeader className="border-b home:border-b-0">
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <SheetFooter className="border-t home:border-t-0">{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}
