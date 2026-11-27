import { Px } from "@/components/pixel/painter";
import { GLYPH_H, textFrame } from "@/components/pixel/font";
import type { Frame } from "@/components/pixel/grid";
import type { OfficeConfig } from "../config";
import type { Interaction } from "./interactions";

/** Who sits where, as stored on the server (members' desks are saved in MongoDB). */
export type Seat =
  | { desk: number; kind: "mine"; name: string }
  | { desk: number; kind: "member"; name: string }
  | { desk: number; kind: "invited"; name: string }
  | { desk: number; kind: "open" };

/** A desk as the server sends it; `at` is the map's 0-based desk index. */
export type ServerSeat =
  | { at: number; kind: "mine" | "member" | "invited"; name: string }
  | { at: number; kind: "open" };

/** `index` is 0-based; desks are numbered from 1. */
export function seatFor(config: OfficeConfig, index: number): Seat {
  const desk = index + 1;
  const s = config.seats?.find((x) => x.at === index);
  return s && s.kind !== "open" ? { desk, kind: s.kind, name: s.name } : { desk, kind: "open" };
}

export function seatLabel(seat: Seat) {
  if (seat.kind === "mine") return `${seat.name} (you)`;
  if (seat.kind === "invited") return `${seat.name} (invited)`;
  if (seat.kind === "member") return seat.name;
  return "Open";
}

/** What walking up to a desk says. */
export function seatInteraction(seat: Seat): Interaction {
  if (seat.kind === "mine") return { action: "desk", prompt: "Your desk" };
  if (seat.kind === "member") return { action: "flavor", prompt: `${seat.name}’s desk`, flavor: `${seat.name} sits here.` };
  if (seat.kind === "invited") {
    return { action: "flavor", prompt: `${seat.name}’s desk`, flavor: `Saved for ${seat.name}. They’ll sit here once they accept the invitation.` };
  }
  return { action: "flavor", prompt: `Open desk ${seat.desk}`, flavor: "Nobody sits here yet. The next teammate to join gets this desk." };
}

const STAR: Frame = ["..k..", ".kkk.", "kkkkk", ".kkk.", ".k.k."];
const MAX_CHARS = 8;

/** Desk nameplate: gold with a star for you, sage for teammates (joined or invited), pale for open desks. */
export function plateFrame(seat: Seat): Frame {
  const raw = seat.kind === "open" ? `Open ${seat.desk}` : seat.name;
  const text = textFrame(raw.length > MAX_CHARS ? raw.slice(0, MAX_CHARS - 1) + "." : raw, seat.kind === "open" ? "A" : "k");
  const icon = seat.kind === "mine" ? STAR : null;
  const tw = text[0].length + (icon ? 6 : 0);
  const p = new Px(tw + 6, GLYPH_H + 4).box(0, 0, tw + 6, GLYPH_H + 4, seat.kind === "mine" ? "y" : seat.kind === "open" ? "m" : "v");
  if (icon) p.stamp(icon, 3, 2);
  return p.stamp(text, icon ? 9 : 3, 2).frame();
}

/** Turn an invitation email into a friendly first name: "sam.lee@x.co" → "Sam". */
export function nameFromEmail(email: string) {
  const first = email.split("@")[0].split(/[._+-]/)[0].replace(/\d+$/, "").replace(/[^\p{L}\d]/gu, "");
  return /\p{L}/u.test(first) ? first[0].toUpperCase() + first.slice(1, 16).toLowerCase() : "Teammate";
}
