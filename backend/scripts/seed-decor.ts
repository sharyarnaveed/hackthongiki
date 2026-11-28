/**
 * Fill the decor shop with the starter catalog (run once after deploying OfficeDecor).
 * Uses the app wallet (CHAIN_PRIVATE_KEY), which must be the contract's owner.
 * Items already in the shop (same name) are skipped, so it's safe to run again.
 *
 *   npm run seed:decor
 */
import { createPublicClient, createWalletClient, defineChain, formatEther, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DECOR_ABI, decorConfigFromEnv } from "../src/lib/decorChain.ts";

/** Name, office furniture it looks like, price in AVAX. Kinds must be in DECOR_KINDS (src/lib/decor.ts). */
const CATALOG: [string, string, string][] = [
  ["Desk Bonsai", "small-plant", "0.005"],
  ["Golden Monstera", "plant", "0.01"],
  ["Neon Floor Lamp", "lamp", "0.01"],
  ["Cloud Beanbag", "beanbag", "0.015"],
  ["Lucky Fig Tree", "tree", "0.02"],
  ["Royal Armchair", "armchair", "0.02"],
  ["Library Shelf", "bookshelf", "0.025"],
  ["Vinyl Player", "record-player", "0.03"],
  ["Cozy Fireplace", "fireplace", "0.05"],
];

const cfg = decorConfigFromEnv();
if (!cfg || "problems" in cfg) {
  console.error(cfg ? cfg.problems.join("\n") : "Set DECOR_CONTRACT (and CHAIN_RPC_URL, CHAIN_ID) in backend/.env first.");
  process.exit(1);
}
const raw = process.env.CHAIN_PRIVATE_KEY?.trim() ?? "";
const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("Set CHAIN_PRIVATE_KEY (the app wallet that deployed OfficeDecor) in backend/.env first.");
  process.exit(1);
}

const chain = defineChain({ id: cfg.chainId, name: `chain ${cfg.chainId}`, nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } });
const account = privateKeyToAccount(key);
const pub = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
const wallet = createWalletClient({ chain, account, transport: http(cfg.rpcUrl) });
const address = cfg.contract;

const owner = await pub.readContract({ address, abi: DECOR_ABI, functionName: "owner" });
if (owner.toLowerCase() !== account.address.toLowerCase()) {
  console.error(`CHAIN_PRIVATE_KEY is ${account.address}, but the contract's owner is ${owner}. Use the wallet that deployed it.`);
  process.exit(1);
}

const count = await pub.readContract({ address, abi: DECOR_ABI, functionName: "itemCount" });
const existing = new Set<string>();
for (let i = 0n; i < count; i++) existing.add((await pub.readContract({ address, abi: DECOR_ABI, functionName: "item", args: [i] }))[0]);

let added = 0;
for (const [name, kind, price] of CATALOG) {
  if (existing.has(name)) {
    console.log(`  · ${name} is already in the shop`);
    continue;
  }
  const hash = await wallet.writeContract({ address, abi: DECOR_ABI, functionName: "addItem", args: [name, kind, parseEther(price)] });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`  ✔ ${name} (${kind}) for ${formatEther(parseEther(price))} AVAX`);
  added++;
}
console.log(added ? `Added ${added} item(s). The backend picks them up within a few seconds.` : "Nothing to add.");
