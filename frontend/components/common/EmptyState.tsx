import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  icon?: LucideIcon;
  /** custom art (e.g. a PixelSprite) instead of an icon */
  art?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, art, title, description, action, className }: Props) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      {art ?? (Icon && (
        <div className="grid size-12 place-items-center bg-muted text-muted-foreground office:rounded-xl home:pixel-border-flat">
          <Icon className="size-5" />
        </div>
      ))}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold home:text-[10px]">{title}</h3>
        {description && <p className="max-w-xs text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
