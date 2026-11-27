/**
 * Tiny pixel-sprite format, rendered as crisp SVG rects by <PixelSprite/>.
 * Each row is a string; each char maps to a palette color ("." = transparent).
 */
export interface Sprite {
  w: number;
  h: number;
  rows: string[];
  palette: Record<string, string>;
}

export function defineSprite(rows: string[], palette: Record<string, string>): Sprite {
  const w = Math.max(...rows.map((r) => r.length));
  return { w, h: rows.length, rows: rows.map((r) => r.padEnd(w, ".")), palette };
}

/* ---------------- Avatars ---------------- */
export interface AvatarLook {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  shoes?: string;
  blush?: string;
}

export const AVATAR_LOOKS: Record<string, AvatarLook> = {
  peach: { skin: "#f5c9a6", hair: "#5a3d2b", shirt: "#e8796b", pants: "#5b6f9a", blush: "#f19a8c" },
  sage: { skin: "#e8b48f", hair: "#2f2432", shirt: "#8fbf86", pants: "#6b4a3a", blush: "#e58f7d" },
  sky: { skin: "#f7d7bd", hair: "#c27a3b", shirt: "#6ea8c9", pants: "#45405a", blush: "#f2a3a0" },
  plum: { skin: "#c98f6b", hair: "#1c1320", shirt: "#a46ad1", pants: "#3a3046", blush: "#d9776a" },
};

const AVATAR_ROWS = [
  "....HHHH....",
  "..HHHHHHHH..",
  ".HHHHHHHHHH.",
  ".HHSSSSSSHH.",
  ".HSSESSESSH.",
  "..SBSSSSBS..",
  "..SSSMMSSS..",
  "...SSSSSS...",
  "..TTTTTTTT..",
  ".TTTTTTTTTT.",
  ".STTTTTTTTS.",
  ".STTTTTTTTS.",
  "..PPPPPPPP..",
  "..PPP..PPP..",
  "..PPP..PPP..",
  "..KKK..KKK..",
];

export function avatarSprite(look: AvatarLook): Sprite {
  return defineSprite(AVATAR_ROWS, {
    H: look.hair,
    S: look.skin,
    E: "#2a1c22",
    M: "#b4574c",
    B: look.blush ?? look.skin,
    T: look.shirt,
    P: look.pants,
    K: look.shoes ?? "#3a2a22",
  });
}

/** Deterministic look for any user id. */
export function lookFor(id: string): AvatarLook {
  const keys = Object.keys(AVATAR_LOOKS);
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_LOOKS[keys[h % keys.length]];
}

/** Fixed looks for the mock couple so they always look the same. */
export const COUPLE_LOOKS: Record<string, AvatarLook> = {
  u1: AVATAR_LOOKS.sky,
  u9: AVATAR_LOOKS.peach,
};

/* ---------------- Small UI glyphs ---------------- */
export const HEART = defineSprite(
  [".RR.RR.", "RRRRRRR", "RRRRRRR", ".RRRRR.", "..RRR..", "...R..."],
  { R: "#e8796b" },
);

export const COIN = defineSprite(
  ["..YYYY..", ".YyyyyY.", "YyYYYYyY", "YyYyyYyY", "YyYyyYyY", "YyYYYYyY", ".YyyyyY.", "..YYYY.."],
  { Y: "#c98a2b", y: "#f3c35b" },
);

export const HOUSE_ICON = defineSprite(
  ["....RR....", "...RRRR...", "..RRRRRR..", ".RRRRRRRR.", "RRRRRRRRRR", ".WWWWWWWW.", ".WWDDWGGW.", ".WWDDWGGW.", ".WWDDWWWW."],
  { R: "#e8796b", W: "#fff1de", D: "#8a5a3c", G: "#9ad3e6" },
);

/* Decor sprites are added in step 5 (lib/pixel/decorSprites.ts). */
