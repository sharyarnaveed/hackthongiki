import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import * as service from "./service";
import { TeamPanel } from "./TeamPanel";

// Keep the pure helpers (canManage, canRemove, labels); replace every API call.
vi.mock("./service", async (importOriginal) => {
  const real = await importOriginal<typeof import("./service")>();
  return {
    ...real,
    getMembers: vi.fn(),
    getInvite: vi.fn(),
    takeDesk: vi.fn(),
    moveMember: vi.fn(),
    requestSwap: vi.fn(),
    acceptSwap: vi.fn(),
    dropSwap: vi.fn(),
    setRole: vi.fn(),
    removeMember: vi.fn(),
    transferOwnership: vi.fn(),
    inviteEmails: vi.fn(),
    resendInvitation: vi.fn(),
    cancelInvitation: vi.fn(),
    regenerateInvite: vi.fn(),
    updateInvite: vi.fn(),
  };
});

const api = vi.mocked(service);

const member = (over: Partial<service.TeamMember>): service.TeamMember => ({
  memberId: "m",
  displayName: "Someone",
  avatarId: "buddy-maya",
  role: "member",
  desk: null,
  status: "available",
  you: false,
  ...over,
});

const olive = member({ memberId: "olive", displayName: "Olive", role: "owner", desk: 1 });
const bob = member({ memberId: "bob", displayName: "Bob", desk: 2, avatarId: "buddy-theo" });
const cat = member({ memberId: "cat", displayName: "Cat", desk: 3, avatarId: "buddy-juno" });

const team = (over: Partial<service.MembersResponse>): service.MembersResponse => ({
  members: [olive, bob, cat],
  role: "member",
  desks: 6,
  deskRequests: [],
  ...over,
});

/** Render and wait until the member list has loaded. */
async function show(ui: ReactElement) {
  render(ui);
  await screen.findByRole("region", { name: /^Members/ });
}
/** A member's row in the member list. */
const row = (name: string) => within(screen.getByRole("region", { name: /^Members/ })).getByText(name).closest("li")!;
const deskPicker = (name: string) => screen.getByRole("combobox", { name: new RegExp(`^Desk for ${name}`) });

beforeEach(() => {
  api.getInvite.mockResolvedValue({ code: "ABCD-EFGH", expiresAt: null, revoked: false, active: true });
});

describe("TeamPanel as a plain member", () => {
  const asBob = () => team({ members: [olive, { ...bob, you: true }, cat] });

  it("lists everyone with their role and desk, without management tools", async () => {
    api.getMembers.mockResolvedValue(asBob());
    await show(<TeamPanel workspaceId="ws1" />);

    expect(await screen.findByText("Members")).toBeInTheDocument();
    expect(screen.getByText("(3)")).toBeInTheDocument();
    expect(within(row("Olive")).getByText("Owner")).toBeInTheDocument();
    expect(within(row("Cat")).getByText("desk 3")).toBeInTheDocument();
    expect(within(row("Bob")).getByText("(you)")).toBeInTheDocument();
    expect(screen.queryByText("Invitation code")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    expect(api.getInvite).not.toHaveBeenCalled();
  });

  it("only offers open desks (and their own) in the desk picker", async () => {
    api.getMembers.mockResolvedValue(asBob());
    await show(<TeamPanel workspaceId="ws1" />);

    const picker = deskPicker("Bob");
    const options = within(picker).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["2", "4", "5", "6"]);
  });

  it("takes an open desk and tells the parent desks changed", async () => {
    api.getMembers.mockResolvedValue(asBob());
    api.takeDesk.mockResolvedValue({ desk: 5, swappedWith: null });
    const onChange = vi.fn();
    await show(<TeamPanel workspaceId="ws1" onChange={onChange} />);

    await userEvent.selectOptions(deskPicker("Bob"), "5");

    expect(api.takeDesk).toHaveBeenCalledWith("ws1", 5);
    expect(await screen.findByRole("status")).toHaveTextContent("You're now at desk 5.");
    expect(onChange).toHaveBeenCalledWith("desks");
  });

  it("asks a teammate to swap desks", async () => {
    api.getMembers.mockResolvedValue(asBob());
    api.requestSwap.mockResolvedValue({ requestId: "r1", requests: [] });
    const onChange = vi.fn();
    await show(<TeamPanel workspaceId="ws1" onChange={onChange} />);

    await userEvent.click(await screen.findByRole("button", { name: "Ask to swap for desk 3" }));

    expect(api.requestSwap).toHaveBeenCalledWith("ws1", "cat");
    expect(await screen.findByRole("status")).toHaveTextContent("Asked Cat to swap desks.");
    // A request doesn't move anyone, so the office needn't reload.
    expect(onChange).toHaveBeenCalledWith("swap-requests");
    expect(api.getMembers).toHaveBeenCalledTimes(2);
  });

  it("shows a sent request and lets you cancel it", async () => {
    api.getMembers.mockResolvedValue({
      ...asBob(),
      deskRequests: [
        { requestId: "r1", direction: "outgoing", from: { memberId: "bob", displayName: "Bob", desk: 2 }, to: { memberId: "cat", displayName: "Cat", desk: 3 }, createdAt: "" },
      ],
    });
    api.dropSwap.mockResolvedValue({ requests: [] });
    await show(<TeamPanel workspaceId="ws1" />);

    expect(await screen.findByText(/You asked/)).toHaveTextContent("You asked Cat for desk 3.");
    expect(within(row("Cat")).getByRole("button", { name: "Swap request open" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.dropSwap).toHaveBeenCalledWith("ws1", "r1");
    expect(await screen.findByRole("status")).toHaveTextContent("Request cancelled.");
  });

  it("accepts an incoming request", async () => {
    api.getMembers.mockResolvedValue(
      team({
        members: [olive, bob, { ...cat, you: true }],
        deskRequests: [
          { requestId: "r1", direction: "incoming", from: { memberId: "bob", displayName: "Bob", desk: 2 }, to: { memberId: "cat", displayName: "Cat", desk: 3 }, createdAt: "" },
        ],
      }),
    );
    api.acceptSwap.mockResolvedValue({ desk: 2, swappedWith: { memberId: "bob", displayName: "Bob", desk: 3 } });
    const onChange = vi.fn();
    await show(<TeamPanel workspaceId="ws1" onChange={onChange} />);

    expect(await screen.findByText(/wants your desk/)).toHaveTextContent("Bob wants your desk 3 and offers desk 2.");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(api.acceptSwap).toHaveBeenCalledWith("ws1", "r1");
    expect(await screen.findByRole("status")).toHaveTextContent("Swapped. You're now at desk 2.");
    expect(onChange).toHaveBeenCalledWith("desks");
  });

  it("shows the server's message when an action fails", async () => {
    api.getMembers.mockResolvedValue(asBob());
    api.requestSwap.mockRejectedValue(new ApiError("Desks just changed. Refresh and try again.", 409));
    const onChange = vi.fn();
    await show(<TeamPanel workspaceId="ws1" onChange={onChange} />);

    await userEvent.click(await screen.findByRole("button", { name: "Ask to swap for desk 3" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Desks just changed. Refresh and try again.");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows an error when the team can't be loaded", async () => {
    api.getMembers.mockRejectedValue(new ApiError("That workspace doesn't exist, or you're not a member.", 404));
    render(<TeamPanel workspaceId="ws1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("That workspace doesn't exist");
  });
});

describe("TeamPanel as the owner", () => {
  const asOwner = (over: Partial<service.MembersResponse> = {}) =>
    team({
      members: [{ ...olive, you: true }, bob, { ...cat, role: "admin" }],
      role: "owner",
      invitations: [{ email: "dana@team.co", sentAt: new Date().toISOString(), invitedAt: null, sendCount: 2 }],
      ...over,
    });

  it("shows the invite code and pending invitations, and no swap requests", async () => {
    api.getMembers.mockResolvedValue(asOwner());
    await show(<TeamPanel workspaceId="ws1" />);

    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    expect(screen.getByText("Works until you turn it off")).toBeInTheDocument();
    expect(screen.getByText("dana@team.co")).toBeInTheDocument();
    expect(screen.getByText(/sent just now · ×2/)).toBeInTheDocument();
    // Owners swap directly with the desk picker instead of asking.
    expect(screen.queryByRole("button", { name: /Ask to swap/ })).not.toBeInTheDocument();
    const picker = deskPicker("Bob");
    expect(within(picker).getByRole("option", { name: "3 (swap)" })).toBeInTheDocument();
  });

  it("promotes and demotes", async () => {
    api.getMembers.mockResolvedValue(asOwner());
    api.setRole.mockResolvedValue({ ...bob, role: "admin" });
    const onChange = vi.fn();
    await show(<TeamPanel workspaceId="ws1" onChange={onChange} />);

    await userEvent.click(within(row("Bob")).getByRole("button", { name: "Make admin" }));
    expect(api.setRole).toHaveBeenCalledWith("ws1", "bob", "admin");
    expect(await screen.findByRole("status")).toHaveTextContent("Bob is now an admin.");
    expect(onChange).toHaveBeenCalledWith("roles");

    await userEvent.click(within(row("Cat")).getByRole("button", { name: "Make member" }));
    expect(api.setRole).toHaveBeenLastCalledWith("ws1", "cat", "member");
  });

  it("asks for confirmation before removing someone", async () => {
    api.getMembers.mockResolvedValue(asOwner());
    api.removeMember.mockResolvedValue({ members: [] });
    await show(<TeamPanel workspaceId="ws1" />);

    const remove = within(row("Bob")).getByRole("button", { name: "Remove" });
    await userEvent.click(remove);
    expect(api.removeMember).not.toHaveBeenCalled();
    await userEvent.click(within(row("Bob")).getByRole("button", { name: "Really remove?" }));
    expect(api.removeMember).toHaveBeenCalledWith("ws1", "bob");
    expect(await screen.findByRole("status")).toHaveTextContent("Bob was removed.");
  });

  it("hands the workspace over after confirming", async () => {
    api.getMembers.mockResolvedValue(asOwner());
    api.transferOwnership.mockResolvedValue({ members: [] });
    await show(<TeamPanel workspaceId="ws1" />);

    await userEvent.click(within(row("Cat")).getByRole("button", { name: "Make owner" }));
    await userEvent.click(within(row("Cat")).getByRole("button", { name: "Hand over to Cat?" }));
    expect(api.transferOwnership).toHaveBeenCalledWith("ws1", "cat");
    expect(await screen.findByRole("status")).toHaveTextContent("Cat owns the workspace now. You're an admin.");
  });

  it("invites a list of emails and sums up the result", async () => {
    api.getMembers.mockResolvedValue(asOwner());
    api.inviteEmails.mockResolvedValue({ added: ["sam@team.co"], skipped: [{ email: "bob@team.co", reason: "already a member" }], sent: 1, failed: 0, invitations: [] });
    await show(<TeamPanel workspaceId="ws1" />);

    const input = await screen.findByLabelText("Email addresses to invite");
    await userEvent.type(input, "sam@team.co, bob@team.co");
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));

    expect(api.inviteEmails).toHaveBeenCalledWith("ws1", ["sam@team.co", "bob@team.co"]);
    expect(await screen.findByRole("status")).toHaveTextContent("Sent 1 invitation. Skipped bob@team.co (already a member).");
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("resends and cancels invitations", async () => {
    api.getMembers.mockResolvedValue(asOwner());
    api.resendInvitation.mockResolvedValue({ invitations: [] });
    api.cancelInvitation.mockResolvedValue({ invitations: [] });
    await show(<TeamPanel workspaceId="ws1" />);

    const invite = (await screen.findByText("dana@team.co")).closest("li")!;
    await userEvent.click(within(invite).getByRole("button", { name: "Resend" }));
    expect(api.resendInvitation).toHaveBeenCalledWith("ws1", "dana@team.co");
    await userEvent.click(within(invite).getByRole("button", { name: "Cancel" }));
    expect(api.cancelInvitation).toHaveBeenCalledWith("ws1", "dana@team.co");
  });

  it("turns the invite code off after confirming", async () => {
    api.getMembers.mockResolvedValue(asOwner());
    api.updateInvite.mockResolvedValue({ code: "ABCD-EFGH", expiresAt: null, revoked: true, active: false });
    await show(<TeamPanel workspaceId="ws1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Turn code off" }));
    await userEvent.click(screen.getByRole("button", { name: "Nobody can join — sure?" }));
    expect(api.updateInvite).toHaveBeenCalledWith("ws1", { revoked: true });
    expect(await screen.findByText("Turned off")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn code on" })).toBeInTheDocument();
  });
});

describe("TeamPanel as an admin", () => {
  it("can remove plain members but not admins or the owner, and can't change roles", async () => {
    api.getMembers.mockResolvedValue(
      team({ members: [olive, bob, { ...cat, role: "admin", you: true }, member({ memberId: "dee", displayName: "Dee", role: "admin", desk: 4 })], role: "admin", invitations: [] }),
    );
    await show(<TeamPanel workspaceId="ws1" />);

    expect(within(row("Bob")).getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(within(row("Dee")).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(within(row("Olive")).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Make (admin|member|owner)/ })).not.toBeInTheDocument();
    expect(await screen.findByText("Invitation code")).toBeInTheDocument();
  });
});

describe("TeamPanel ownership NFT", () => {
  const nft: service.Ownership = {
    chainId: 43113,
    contract: "0x1111111111111111111111111111111111111111",
    tokenId: "0x665f1c2ab3e4d5f6a7b8c9d0",
    minted: true,
    holder: "0x2222222222222222222222222222222222222222",
    inCustody: false,
    syncedAt: "2026-11-28T00:00:00Z",
    error: null,
    url: "https://testnet.snowtrace.io/nft/0x1111111111111111111111111111111111111111/1",
    contractUrl: null,
  };
  const section = () => screen.getByRole("region", { name: "Ownership NFT" });

  it("shows whose wallet holds the token, with a Snowtrace link", async () => {
    api.getMembers.mockResolvedValue(team({ ownership: nft }));
    await show(<TeamPanel workspaceId="ws1" />);
    expect(section()).toHaveTextContent("Olive's wallet 0x2222…2222");
    expect(within(section()).getByRole("link", { name: /View on Snowtrace/ })).toHaveAttribute("href", nft.url);
  });

  it("says the app holds it until the owner links a wallet", async () => {
    api.getMembers.mockResolvedValue(team({ members: [{ ...olive, you: true }, bob], ownership: { ...nft, inCustody: true } }));
    await show(<TeamPanel workspaceId="ws1" />);
    expect(section()).toHaveTextContent("held by TheSpace until you link a wallet");
  });

  it("is hidden when on-chain ownership is off", async () => {
    api.getMembers.mockResolvedValue(team({ ownership: null }));
    await show(<TeamPanel workspaceId="ws1" />);
    expect(screen.queryByRole("region", { name: "Ownership NFT" })).toBeNull();
  });
});
