import { memo } from "react";
import type { Sprite } from "@/lib/pixel/sprites";
import { cn } from "@/lib/utils";

interface Props {
  sprite: Sprite;
  /** size of one sprite pixel in CSS px */
  scale?: number;
  className?: string;
  title?: string;
}

/** Renders a Sprite as crisp SVG rects (merges horizontal runs). */
export const PixelSprite = memo(function PixelSprite({ sprite, scale = 4, className, title }: Props) {
  const rects: React.ReactNode[] = [];
  sprite.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === "." || !sprite.palette[ch]) { x++; continue; }
      let len = 1;
      while (row[x + len] === ch) len++;
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={len} height={1} fill={sprite.palette[ch]} />);
      x += len;
    }
  });
  return (
    <svg
      viewBox={`0 0 ${sprite.w} ${sprite.h}`}
      width={sprite.w * scale}
      height={sprite.h * scale}
      shapeRendering="crispEdges"
      className={cn("pixelated block", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {rects}
    </svg>
  );
});
