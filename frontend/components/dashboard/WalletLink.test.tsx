import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import * as wallet from "@/lib/wallet";
import { WalletLink } from "./WalletLink";

vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), apiPost: vi.fn(), apiDelete: vi.fn() }));
vi.mock("@/lib/wallet", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/wallet")>()), signInMessage: vi.fn() }));

const ADDRESS = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";

describe("WalletLink", () => {
  it("signs a link message and shows the linked address", async () => {
    vi.mocked(wallet.signInMessage).mockResolvedValue({ message: "msg", signature: "0xsig", address: ADDRESS });
    vi.mocked(api.apiPost).mockResolvedValue({ user: { wallet: ADDRESS } });
    const onChange = vi.fn();
    render(<WalletLink wallet={null} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /link wallet/i }));

    expect(wallet.signInMessage).toHaveBeenCalledWith("link");
    expect(api.apiPost).toHaveBeenCalledWith("/api/auth/wallet/link", { message: "msg", signature: "0xsig" });
    expect(onChange).toHaveBeenCalledWith(ADDRESS);
  });

  it("shows the linked wallet and unlinks it", async () => {
    vi.mocked(api.apiDelete).mockResolvedValue({ user: { wallet: null } });
    const onChange = vi.fn();
    render(<WalletLink wallet={ADDRESS} onChange={onChange} />);

    expect(screen.getByText("0xAbCd…Ef01")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /unlink wallet/i }));

    expect(api.apiDelete).toHaveBeenCalledWith("/api/auth/wallet");
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows the server's reason when the wallet belongs to someone else", async () => {
    vi.mocked(wallet.signInMessage).mockResolvedValue({ message: "msg", signature: "0xsig", address: ADDRESS });
    vi.mocked(api.apiPost).mockRejectedValue(new api.ApiError("This wallet is already linked to another account.", 409));
    const onChange = vi.fn();
    render(<WalletLink wallet={null} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /link wallet/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already linked to another account");
    expect(onChange).not.toHaveBeenCalled();
  });
});
