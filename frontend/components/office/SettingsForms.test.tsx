import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { OfficeConfig } from "./config";
import { LookForm, ProfileForm } from "./SettingsForms";

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
  ...over,
});

describe("ProfileForm", () => {
  const save = () => screen.getByRole("button", { name: "Save name tag & avatar" });

  it("starts with the current name tag and only enables saving after a change", async () => {
    render(<ProfileForm config={config()} onSave={vi.fn()} />);
    const name = screen.getByRole("textbox", { name: "Name tag" });
    expect(name).toHaveValue("Olive");
    expect(screen.getByRole("radio", { name: "Maya" })).toBeChecked();
    expect(save()).toBeDisabled();

    await userEvent.type(name, "!");
    expect(save()).toBeEnabled();
    await userEvent.type(name, "{Backspace}");
    expect(save()).toBeDisabled();
  });

  it("sends only what changed, trimmed", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProfileForm config={config()} onSave={onSave} />);

    const name = screen.getByRole("textbox", { name: "Name tag" });
    await userEvent.clear(name);
    await userEvent.type(name, "  Liv  ");
    await userEvent.click(save());
    expect(onSave).toHaveBeenLastCalledWith({ displayName: "Liv" });
  });

  it("saves a new avatar on its own", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProfileForm config={config()} onSave={onSave} />);

    await userEvent.click(screen.getByRole("radio", { name: "Theo" }));
    await userEvent.click(save());
    expect(onSave).toHaveBeenCalledWith({ avatarId: "buddy-theo" });
  });

  it("refuses an empty name tag without calling the server", async () => {
    const onSave = vi.fn();
    render(<ProfileForm config={config()} onSave={onSave} />);

    await userEvent.clear(screen.getByRole("textbox", { name: "Name tag" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Name tag" }), "   ");
    await userEvent.click(save());
    expect(screen.getByRole("alert")).toHaveTextContent("Tell us what to put on your name tag.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the server's error and lets you try again", async () => {
    const onSave = vi.fn().mockRejectedValue(new ApiError("Invalid details.", 400));
    render(<ProfileForm config={config()} onSave={onSave} />);

    await userEvent.click(screen.getByRole("radio", { name: "Juno" }));
    await userEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid details.");
    expect(save()).toBeEnabled();
  });
});

describe("LookForm", () => {
  const save = () => screen.getByRole("button", { name: /Save style & furniture|Rebuilding/ });

  it("shows the current style and ticked furniture", () => {
    render(<LookForm config={config()} onSave={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Cozy and green" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Desks" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Plants & trees" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Rugs" })).not.toBeChecked();
    expect(save()).toBeDisabled();
  });

  it("only offers furniture the floor plan has room for", () => {
    const { unmount } = render(<LookForm config={config({ layout: "classic" })} onSave={vi.fn()} />);
    expect(screen.queryByRole("checkbox", { name: "Bed" })).not.toBeInTheDocument();
    unmount();
    render(<LookForm config={config({ layout: "home" })} onSave={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Bed" })).toBeInTheDocument();
  });

  it("saves a new style together with the furniture", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<LookForm config={config()} onSave={onSave} />);

    await userEvent.click(screen.getByRole("radio", { name: "Creative studio" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Plants & trees" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Rugs" }));
    await userEvent.click(save());

    expect(onSave).toHaveBeenCalledTimes(1);
    const sent = onSave.mock.calls[0][0];
    expect(sent.workspaceStyle).toBe("creative-studio");
    expect([...sent.officeFeatures].sort()).toEqual(["desks", "kitchen", "rugs"]);
    expect(save()).toHaveTextContent("Rebuilding…");
  });

  it("treats toggling back to the original as no change", async () => {
    render(<LookForm config={config()} onSave={vi.fn()} />);
    const rugs = screen.getByRole("checkbox", { name: "Rugs" });
    await userEvent.click(rugs);
    expect(save()).toBeEnabled();
    await userEvent.click(rugs);
    expect(save()).toBeDisabled();
  });

  it("shows the server's error and re-enables saving", async () => {
    const onSave = vi.fn().mockRejectedValue(new ApiError("Only the workspace owner can change the office.", 403));
    render(<LookForm config={config()} onSave={onSave} />);

    await userEvent.click(screen.getByRole("radio", { name: "Quiet and minimal" }));
    await userEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the workspace owner can change the office.");
    expect(save()).toHaveTextContent("Save style & furniture");
    expect(save()).toBeEnabled();
  });
});
