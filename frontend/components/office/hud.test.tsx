import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { OfficeConfig } from "./config";
import { Hud, PlayerAnchor, Toast, officeBadge } from "./hud";

const config = (over: Partial<OfficeConfig> = {}): OfficeConfig => ({
  displayName: "Olive",
  avatarId: "buddy-maya",
  workspaceName: "HQ",
  workspaceDescription: "",
  workspaceStyle: "cozy-green",
  purpose: "remote-team",
  teamSize: "6-15",
  layout: "classic",
  features: ["desks", "plants", "kitchen"],
  teammates: [],
  role: "owner",
  workspaceId: "ws1",
  ...over,
});

const prompt = { id: "coffee", interaction: { action: "coffee", prompt: "Make coffee" } } as ComponentProps<typeof Hud>["prompt"];

function hud(over: Partial<ComponentProps<typeof Hud>> = {}) {
  const props: ComponentProps<typeof Hud> = {
    config: config(),
    mapSize: { width: 40, height: 26 },
    room: "",
    status: "available",
    onStatus: vi.fn(),
    settings: { sound: false, minimap: true, nameTag: true },
    prompt: null,
    onInteract: vi.fn(),
    onSound: vi.fn(),
    onSettings: vi.fn(),
    onMembers: vi.fn(),
    ...over,
  };
  render(<Hud {...props} />);
  return props;
}

describe("officeBadge", () => {
  it("names the viewer's role", () => {
    expect(officeBadge(config({ role: "owner" }))).toBe("Owner");
    expect(officeBadge(config({ role: "admin" }))).toBe("Admin");
    expect(officeBadge(config({ role: "member" }))).toBe("Member");
    expect(officeBadge(config({ role: undefined }))).toBe("Member");
  });
});

describe("Hud", () => {
  it("shows the workspace, the viewer's role and name, and links back to the dashboard", () => {
    hud({ config: config({ role: "admin" }) });
    expect(screen.getByText("HQ")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Olive")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  it("shows the room only once there is one", () => {
    hud();
    expect(screen.queryByText("Kitchen")).not.toBeInTheDocument();
    hud({ room: "Kitchen" });
    expect(screen.getByText("Kitchen")).toBeInTheDocument();
  });

  it("marks the current status and sets a new one", async () => {
    const { onStatus } = hud({ status: "focusing" });
    const group = screen.getByRole("radiogroup", { name: "Your status" });
    expect(within(group).getByRole("radio", { name: /Focus/ })).toBeChecked();
    expect(within(group).getByRole("radio", { name: /Available/ })).not.toBeChecked();

    await userEvent.click(within(group).getByRole("radio", { name: /Break/ }));
    expect(onStatus).toHaveBeenCalledWith("break");
  });

  it("labels the music button by what it will do", async () => {
    const { onSound } = hud();
    const off = screen.getByRole("button", { name: "Play music" });
    expect(off).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(off);
    expect(onSound).toHaveBeenCalledOnce();

    hud({ settings: { sound: true, minimap: true, nameTag: true } });
    expect(screen.getByRole("button", { name: "Mute music" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens settings and members", async () => {
    const { onSettings, onMembers } = hud();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.click(screen.getByRole("button", { name: "Members" }));
    expect(onSettings).toHaveBeenCalledOnce();
    expect(onMembers).toHaveBeenCalledOnce();
  });

  it("offers a clickable interact button only while something is in reach", async () => {
    hud();
    expect(screen.queryByRole("button", { name: /Make coffee/ })).not.toBeInTheDocument();

    const { onInteract } = hud({ prompt });
    await userEvent.click(screen.getByRole("button", { name: /Make coffee/ }));
    expect(onInteract).toHaveBeenCalledOnce();
  });

  it("frames the minimap only when it's on", () => {
    // 40×26 tiles × 16 px × 0.25 scale = 160×104, plus the 2 px border on each side.
    hud();
    expect(document.querySelector('[style*="width: 164px"][style*="height: 108px"]')).not.toBeNull();
  });

  it("drops the minimap frame when the minimap is off", () => {
    hud({ settings: { sound: false, minimap: false, nameTag: true } });
    expect(document.querySelector('[style*="width: 164px"]')).toBeNull();
  });

  describe("desk swap badge", () => {
    it("has no badge when nothing is waiting", () => {
      hud({ swapsWaiting: 0 });
      expect(screen.getByRole("button", { name: "Members" })).toBeInTheDocument();
      expect(screen.queryByTestId("swap-badge")).not.toBeInTheDocument();
    });

    it("counts waiting requests on the members button", async () => {
      const { onMembers } = hud({ swapsWaiting: 2 });
      const button = screen.getByRole("button", { name: "Members, 2 desk swap requests waiting" });
      expect(within(button).getByTestId("swap-badge")).toHaveTextContent("2");
      await userEvent.click(button);
      expect(onMembers).toHaveBeenCalledOnce();
    });

    it("uses the singular for one request", () => {
      hud({ swapsWaiting: 1 });
      expect(screen.getByRole("button", { name: "Members, 1 desk swap request waiting" })).toBeInTheDocument();
    });

    it("caps the badge at 9+", () => {
      hud({ swapsWaiting: 12 });
      expect(screen.getByTestId("swap-badge")).toHaveTextContent("9+");
      expect(screen.getByRole("button", { name: "Members, 12 desk swap requests waiting" })).toBeInTheDocument();
    });
  });
});

describe("PlayerAnchor", () => {
  it("shows the name tag and the press-E hint", () => {
    render(<PlayerAnchor ref={null} name="Olive" status="available" showName prompt={prompt} />);
    expect(screen.getByText("Olive")).toBeInTheDocument();
    expect(screen.getByText(/Make coffee/)).toHaveTextContent("Make coffee — Press E");
  });

  it("hides the name tag when turned off", () => {
    render(<PlayerAnchor ref={null} name="Olive" status="available" showName={false} prompt={null} />);
    expect(screen.queryByText("Olive")).not.toBeInTheDocument();
  });
});

describe("Toast", () => {
  it("announces its text", () => {
    render(<Toast text="Fresh coffee brewed." />);
    expect(screen.getByRole("status")).toHaveTextContent("Fresh coffee brewed.");
  });
});
