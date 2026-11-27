import type { Wallet } from "@/lib/types";
import { iso } from "../delay";
import { COUPLE_ID } from "./couple";

export const wallet: Wallet = {
  id: "wal1",
  coupleId: COUPLE_ID,
  address: "0x7a3B…c91E",
  balanceUsdc: 1284.5,
  goals: [
    { id: "g1", name: "Trip to Kyoto", emoji: "🗾", targetUsdc: 3000, savedUsdc: 1860, dueDate: "2027-04-01" },
    { id: "g2", name: "New couch fund", emoji: "🛋️", targetUsdc: 800, savedUsdc: 240 },
  ],
  transactions: [
    { id: "t1", kind: "purchase", label: "Buy Arcade Cabinet", amountUsdc: -120, createdAt: iso(0, 1), createdBy: "u9", status: "pending", approvals: ["u9"] },
    { id: "t2", kind: "withdraw", label: "Withdraw for concert tickets", amountUsdc: -150, createdAt: iso(0, 4), createdBy: "u1", status: "pending", approvals: ["u1"] },
    { id: "t3", kind: "deposit", label: "Monthly deposit", amountUsdc: 400, createdAt: iso(2), createdBy: "u1", status: "completed", approvals: ["u1", "u9"] },
    { id: "t4", kind: "goal", label: "Moved to Trip to Kyoto", amountUsdc: -200, createdAt: iso(3), createdBy: "u9", status: "completed", approvals: ["u1", "u9"] },
    { id: "t5", kind: "purchase", label: "Bought Paper Lantern", amountUsdc: -18, createdAt: iso(5), createdBy: "u9", status: "completed", approvals: ["u1", "u9"] },
    { id: "t6", kind: "sale", label: "Sold Beanbag", amountUsdc: 22, createdAt: iso(8), createdBy: "u1", status: "completed", approvals: ["u1", "u9"] },
    { id: "t7", kind: "withdraw", label: "Withdraw for dinner", amountUsdc: -60, createdAt: iso(11), createdBy: "u1", status: "rejected", approvals: ["u1"], rejectedBy: "u9" },
    { id: "t8", kind: "deposit", label: "Monthly deposit", amountUsdc: 400, createdAt: iso(32), createdBy: "u9", status: "completed", approvals: ["u1", "u9"] },
  ],
};
