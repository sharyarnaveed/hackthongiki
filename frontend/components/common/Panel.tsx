import { cn } from "@/lib/utils";

/**
 * Generic surface. Office: bordered rounded card. Home: crisp pixel frame.
 * Use for anything that isn't semantically a shadcn Card.
 */
export function Panel({
  className, inset, ...props
}: React.ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      className={cn(
        "bg-card text-card-foreground",
        "office:rounded-lg office:border office:shadow-elev-1",
        "home:pixel-border home:m-1",
        inset && "p-4",
        className,
      )}
      {...props}
    />
  );
}
