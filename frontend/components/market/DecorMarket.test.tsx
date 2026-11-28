import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as market from "@/lib/decorMarket";
import { WalletError } from "@/lib/wallet";
import { DecorMarket } from "./DecorMarket";

// Keep parsePrice real; replace the API and wallet calls.
vi.mock("@/lib/decorMarket", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/decorMarket")>();
  return { ...real, getMarket: vi.fn(), getMyDecor: vi.fn(), sendDecorTx: vi.fn(), placeDecor: vi.fn(), removeDecor: vi.fn() };
});
const api = vi.mocked(market);

const WALLET = "0x2222222222222222222222222222222222222222";
const SELLER = "0x3333333333333333333333333333333333333333";
const open: market.Market = {
  enabled: true,
  chainId: 43113,
  contract: "0x1111111111111111111111111111111111111111",
  explorer: "https://testnet.snowtrace.io",
  items: [
    { itemId: 0, name: "Golden Monstera", kind: "plant", priceWei: "10000000000000000", price: "0.01", forSale: true },
    { itemId: 1, name: "Cozy Fireplace", kind: "fireplace", priceWei: "50000000000000000", price: "0.05", forSale: false },
  ],
  listings: [
    { tokenId: 7, itemId: 0, name: "Golden Monstera", kind: "plant", seller: SELLER, priceWei: "30000000000000000", price: "0.03", mine: false },
    { tokenId: 8, itemId: 0, name: "Golden Monstera", kind: "plant", seller: WALLET, priceWei: "40000000000000000", price: "0.04", mine: true },
  ],
};
const lamp: market.MyDecor = { tokenId: 3, itemId: 2, name: "Neon Floor Lamp", kind: "lamp", listed: null, placedIn: null, url: "https://testnet.snowtrace.io/nft/0x1/3" };
const offices = [
  { workspaceId: "ws1", name: "HQ", role: "owner" },
  { workspaceId: "ws2", name: "Friends", role: "member" },
];

async function show(wallet: string | null = WALLET) {
  render(<DecorMarket wallet={wallet} workspaces={offices} />);
  await screen.findByRole("tablist");
}
const card = (name: string) => screen.getAllByText(name)[0].closest("li")!;

beforeEach(() => {
  vi.clearAllMocks();
  api.getMarket.mockResolvedValue(open);
  api.getMyDecor.mockResolvedValue({ wallet: WALLET, tokens: [lamp] });
  api.sendDecorTx.mockResolvedValue("0xabc");
});

describe("DecorMarket", () => {
  it("explains how to turn it on when the server has no decor contract", async () => {
    api.getMarket.mockResolvedValue({ enabled: false });
    render(<DecorMarket wallet={WALLET} workspaces={offices} />);
    expect(await screen.findByText(/isn't set up on this server yet/)).toBeInTheDocument();
  });

  it("buys from the shop with the item's exact price", async () => {
    await show();
    expect(within(card("Cozy Fireplace")).getByRole("button", { name: /Sold out/ })).toBeDisabled();
    await userEvent.click(within(card("Golden Monstera")).getByRole("button", { name: "Buy" }));
    expect(api.sendDecorTx).toHaveBeenCalledWith(open, WALLET, { type: "buy", itemId: 0, priceWei: "10000000000000000" });
    expect(await screen.findByText(/You bought a Golden Monstera/)).toBeInTheDocument();
  });

  it("can't buy without a linked wallet", async () => {
    await show(null);
    expect(screen.getByText(/Link a wallet on your dashboard/)).toBeInTheDocument();
    expect(within(card("Golden Monstera")).getByRole("button", { name: "Buy" })).toBeDisabled();
  });

  it("buys other people's listings and cancels your own", async () => {
    await show();
    await userEvent.click(screen.getByRole("tab", { name: /Market \(2\)/ }));
    const [theirs, mine] = screen.getAllByRole("listitem");
    expect(theirs).toHaveTextContent("0.03 AVAX · from 0x3333…3333");
    await userEvent.click(within(theirs).getByRole("button", { name: "Buy for 0.03" }));
    expect(api.sendDecorTx).toHaveBeenLastCalledWith(open, WALLET, { type: "buyListing", tokenId: 7, priceWei: "30000000000000000" });
    await userEvent.click(within(mine).getByRole("button", { name: /Cancel sale/ }));
    expect(api.sendDecorTx).toHaveBeenLastCalledWith(open, WALLET, { type: "cancel", tokenId: 8 });
  });

  it("places your decor in an office you own (only those are offered)", async () => {
    api.placeDecor.mockResolvedValue({ tokenId: 3, kind: "lamp", tx: 5, ty: 6 });
    await show();
    await userEvent.click(screen.getByRole("tab", { name: /My decor \(1\)/ }));
    const picker = screen.getByRole("combobox", { name: "Office for Neon Floor Lamp" });
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["HQ"]);
    await userEvent.click(screen.getByRole("button", { name: /Place/ }));
    expect(api.placeDecor).toHaveBeenCalledWith("ws1", 3);
    expect(await screen.findByText(/is in your office now/)).toBeInTheDocument();
  });

  it("takes placed decor out of the office", async () => {
    api.getMyDecor.mockResolvedValue({ wallet: WALLET, tokens: [{ ...lamp, placedIn: { workspaceId: "ws1", name: "HQ" } }] });
    api.removeDecor.mockResolvedValue({ removed: 3 });
    await show();
    await userEvent.click(screen.getByRole("tab", { name: /My decor/ }));
    expect(screen.getByText("In “HQ”")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Take out of office/ }));
    expect(api.removeDecor).toHaveBeenCalledWith("ws1", 3);
  });

  it("lists decor for sale, checking the price first", async () => {
    await show();
    await userEvent.click(screen.getByRole("tab", { name: /My decor/ }));
    await userEvent.click(screen.getByRole("button", { name: /Sell/ }));
    const price = screen.getByRole("textbox", { name: "Price for Neon Floor Lamp in AVAX" });
    await userEvent.type(price, "abc");
    expect(screen.getByText("Enter a price in AVAX, like 0.05.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List" })).toBeDisabled();
    await userEvent.clear(price);
    await userEvent.type(price, "0.05");
    await userEvent.click(screen.getByRole("button", { name: "List" }));
    expect(api.sendDecorTx).toHaveBeenCalledWith(open, WALLET, { type: "list", tokenId: 3, price: "0.05" });
  });

  it("shows the wallet's reason when a transaction fails", async () => {
    api.sendDecorTx.mockRejectedValue(new WalletError("You cancelled the transaction in your wallet."));
    await show();
    await userEvent.click(within(card("Golden Monstera")).getByRole("button", { name: "Buy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You cancelled the transaction in your wallet.");
  });
});

describe("parsePrice", () => {
  it("turns AVAX into wei and refuses nonsense", () => {
    expect(market.parsePrice("0.05")).toBe(BigInt("50000000000000000"));
    expect(market.parsePrice("1")).toBe(BigInt("1000000000000000000"));
    expect(market.parsePrice("0")).toBe("The price must be more than 0.");
    expect(market.parsePrice("-1")).toMatch(/Enter a price/);
    expect(market.parsePrice("1e5")).toMatch(/Enter a price/);
  });
});
