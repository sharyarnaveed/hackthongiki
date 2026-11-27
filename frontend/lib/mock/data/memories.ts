import type { Memory } from "@/lib/types";
import { COUPLE_ID } from "./couple";

const g = (a: string, b: string) => `linear-gradient(135deg, ${a}, ${b})`;

export const memories: Memory[] = [
  { id: "mem1", coupleId: COUPLE_ID, title: "First date", note: "Ramen, rain, and a two-hour walk home.", gradient: g("#f6a6a1", "#f9d89c"), emoji: "🍜", date: "2025-10-12", authorId: "u1" },
  { id: "mem2", coupleId: COUPLE_ID, title: "Beach weekend", note: "Sam built the world's worst sandcastle.", gradient: g("#9ad3e6", "#f7e1b5"), emoji: "🏖️", date: "2026-03-08", authorId: "u9" },
  { id: "mem3", coupleId: COUPLE_ID, title: "Moved in!", note: "Boxes everywhere. Pizza on the floor.", gradient: g("#c7b8ea", "#f2c6de"), emoji: "📦", date: "2026-05-20", authorId: "u1" },
  { id: "mem4", coupleId: COUPLE_ID, title: "Garden day", note: "Planted basil, tomatoes, and one stubborn rose.", gradient: g("#b9d8b0", "#f5e6a8"), emoji: "🌱", date: "2026-06-14", authorId: "u9" },
  { id: "mem5", coupleId: COUPLE_ID, title: "Movie marathon", note: "Fell asleep before the third film. Again.", gradient: g("#3d2c47", "#f0a85a"), emoji: "🍿", date: "2026-09-02", authorId: "u1" },
  { id: "mem6", coupleId: COUPLE_ID, title: "Anniversary", note: "One year of us. Here's to many more.", gradient: g("#e8796b", "#f9c5a8"), emoji: "💞", date: "2026-10-12", authorId: "u9" },
];
