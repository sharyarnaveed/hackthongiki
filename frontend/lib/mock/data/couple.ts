import type { Couple, House } from "@/lib/types";
import { iso } from "../delay";

export const COUPLE_ID = "cp1";

export const couple: Couple = {
  id: COUPLE_ID,
  partnerIds: ["u1", "u9"],
  houseId: "h1",
  inviteCode: "COZY-7K2Q",
  since: iso(410),
};

/** 16 × 12 tile house. Row 0 is the back wall. */
export const house: House = {
  id: "h1",
  coupleId: COUPLE_ID,
  cols: 16,
  rows: 12,
  rooms: [
    { id: "hr1", kind: "living", name: "Living room", x: 0, y: 0, w: 10, h: 7 },
    { id: "hr2", kind: "kitchen", name: "Kitchen", x: 10, y: 0, w: 6, h: 7 },
    { id: "hr3", kind: "bedroom", name: "Bedroom", x: 0, y: 7, w: 16, h: 5 },
  ],
  placed: [
    { instanceId: "p1", itemId: "d1", x: 2, y: 2, rotation: 0 }, // sofa 3x1
    { instanceId: "p2", itemId: "d3", x: 3, y: 4, rotation: 0 }, // rug 3x2
    { instanceId: "p3", itemId: "d2", x: 1, y: 1, rotation: 0 }, // plant
    { instanceId: "p4", itemId: "d6", x: 11, y: 1, rotation: 0 }, // fridge 1x2
    { instanceId: "p5", itemId: "d7", x: 12, y: 1, rotation: 0 }, // stove 1x1
    { instanceId: "p6", itemId: "d4", x: 2, y: 8, rotation: 0 }, // bed 2x3? (2x2)
    { instanceId: "p7", itemId: "d5", x: 7, y: 1, rotation: 0 }, // tv 2x1
  ],
  positions: {
    u1: { x: 4, y: 3 },
    u9: { x: 6, y: 3 },
  },
};
