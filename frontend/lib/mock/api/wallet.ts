import type { SavingsGoal, Transaction, Wallet } from "@/lib/types";
import { db } from "../db";
import { COUPLE_ID } from "../data/couple";
import { CURRENT_USER_ID, PARTNER_ID } from "../data/users";
import { clone, iso, sleep, uid } from "../delay";

export async function getWallet(): Promise<Wallet> {
  await sleep();
  return clone(db.wallet);
}

const settle = (tx: Transaction) => {
  tx.status = "completed";
  db.wallet.balanceUsdc = +(db.wallet.balanceUsdc + tx.amountUsdc).toFixed(2);
  if (tx.kind === "purchase") {
    const name = tx.label.replace(/^Buy /, "");
    const item = db.decor.find((d) => d.name === name);
    if (item) {
      item.ownerId = COUPLE_ID;
      item.forSale = false;
      db.listings = db.listings.filter((l) => l.itemId !== item.id);
    }
  }
};

/** Approve as the current user. Completes once both partners approved. */
export async function approve(txId: string): Promise<Transaction> {
  await sleep(400, 800);
  const tx = db.wallet.transactions.find((t) => t.id === txId);
  if (!tx || tx.status !== "pending") throw new Error("Transaction is not pending");
  if (!tx.approvals.includes(CURRENT_USER_ID)) tx.approvals.push(CURRENT_USER_ID);
  if (tx.approvals.length >= 2) settle(tx);
  return clone(tx);
}

/** Demo helper: pretend the partner approved from their device. */
export async function simulatePartnerApprove(txId: string): Promise<Transaction> {
  await sleep(800, 1400);
  const tx = db.wallet.transactions.find((t) => t.id === txId);
  if (!tx || tx.status !== "pending") throw new Error("Transaction is not pending");
  if (!tx.approvals.includes(PARTNER_ID)) tx.approvals.push(PARTNER_ID);
  if (tx.approvals.length >= 2) settle(tx);
  return clone(tx);
}

export async function reject(txId: string): Promise<Transaction> {
  await sleep(300, 600);
  const tx = db.wallet.transactions.find((t) => t.id === txId);
  if (!tx || tx.status !== "pending") throw new Error("Transaction is not pending");
  tx.status = "rejected";
  tx.rejectedBy = CURRENT_USER_ID;
  return clone(tx);
}

export async function requestWithdraw(amountUsdc: number, label: string): Promise<Transaction> {
  await sleep();
  const tx: Transaction = {
    id: uid("t"), kind: "withdraw", label, amountUsdc: -Math.abs(amountUsdc), createdAt: iso(),
    createdBy: CURRENT_USER_ID, status: "pending", approvals: [CURRENT_USER_ID],
  };
  db.wallet.transactions.unshift(tx);
  return clone(tx);
}

export async function deposit(amountUsdc: number): Promise<Wallet> {
  await sleep(500, 900);
  db.wallet.transactions.unshift({
    id: uid("t"), kind: "deposit", label: "Deposit", amountUsdc: Math.abs(amountUsdc), createdAt: iso(),
    createdBy: CURRENT_USER_ID, status: "completed", approvals: [CURRENT_USER_ID, PARTNER_ID],
  });
  db.wallet.balanceUsdc = +(db.wallet.balanceUsdc + Math.abs(amountUsdc)).toFixed(2);
  return clone(db.wallet);
}

export async function createGoal(goal: Omit<SavingsGoal, "id" | "savedUsdc">): Promise<SavingsGoal> {
  await sleep();
  const g: SavingsGoal = { ...goal, id: uid("g"), savedUsdc: 0 };
  db.wallet.goals.push(g);
  return clone(g);
}

export async function addToGoal(goalId: string, amountUsdc: number): Promise<Wallet> {
  await sleep();
  const g = db.wallet.goals.find((x) => x.id === goalId);
  if (!g) throw new Error("Goal not found");
  if (amountUsdc > db.wallet.balanceUsdc) throw new Error("Not enough balance");
  g.savedUsdc += amountUsdc;
  db.wallet.balanceUsdc = +(db.wallet.balanceUsdc - amountUsdc).toFixed(2);
  db.wallet.transactions.unshift({
    id: uid("t"), kind: "goal", label: `Moved to ${g.name}`, amountUsdc: -amountUsdc, createdAt: iso(),
    createdBy: CURRENT_USER_ID, status: "completed", approvals: [CURRENT_USER_ID, PARTNER_ID],
  });
  return clone(db.wallet);
}
