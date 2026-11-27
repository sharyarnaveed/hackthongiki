import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import type { WorkspaceSummary } from "./Dashboard";
import { DeleteWorkspaceDialog, Dialog, EditWorkspaceDialog, MembersDialog } from "./WorkspaceDialogs";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));
// The members dialog only wraps TeamPanel, which has its own tests.
vi.mock("@/components/team/TeamPanel", () => ({
  TeamPanel: ({ workspaceId }: { workspaceId: string }) => <p>Team of {workspaceId}</p>,
}));
const http = vi.mocked(api);

const summary = (over: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  workspaceId: "ws1",
  name: "HQ",
  description: "Where we build",
  memberCount: 3,
  purpose: "remote-team",
  teamSize: "6-15",
  workspaceStyle: "cozy-green",
  officeLayout: "classic",
  officeFeatures: ["desks"],
  role: "owner",
  displayName: "Olive",
  avatarId: "buddy-maya",
  ...over,
});

describe("Dialog", () => {
  it("closes with Escape, the close button, or a click on the backdrop", async () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Hello" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Hello" });
    expect(dialog).toHaveTextContent("Body");

    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("stays open when clicking inside it", async () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Hello" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByText("Body"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("EditWorkspaceDialog", () => {
  const name = () => screen.getByRole("textbox", { name: "Workspace name" });
  const description = () => screen.getByRole("textbox", { name: /Description/ });

  it("starts with the current name and description", () => {
    render(<EditWorkspaceDialog ws={summary()} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(name()).toHaveValue("HQ");
    expect(name()).toHaveFocus();
    expect(description()).toHaveValue("Where we build");
    expect(screen.getByText(/^14\//)).toBeInTheDocument();
  });

  it("saves the trimmed name and description", async () => {
    const onSaved = vi.fn();
    http.apiPatch.mockResolvedValue({ name: "Studio", description: "New home" });
    render(<EditWorkspaceDialog ws={summary()} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.clear(name());
    await userEvent.type(name(), "  Studio ");
    await userEvent.clear(description());
    await userEvent.type(description(), " New home  ");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(http.apiPatch).toHaveBeenCalledWith("/api/workspaces/ws1", { workspaceName: "Studio", workspaceDescription: "New home" });
    expect(onSaved).toHaveBeenCalledWith({ name: "Studio", description: "New home" });
  });

  it("refuses an empty name without calling the server", async () => {
    render(<EditWorkspaceDialog ws={summary()} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.clear(name());
    await userEvent.type(name(), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByText("Your office needs a name on the door.")).toBeInTheDocument();
    expect(name()).toHaveAttribute("aria-invalid", "true");
    expect(http.apiPatch).not.toHaveBeenCalled();

    // Typing clears the error.
    await userEvent.type(name(), "x");
    expect(screen.queryByText("Your office needs a name on the door.")).not.toBeInTheDocument();
  });

  it("shows the server's field and form errors and lets you try again", async () => {
    const onSaved = vi.fn();
    http.apiPatch.mockRejectedValueOnce(new ApiError("Please fix the name.", 400, { workspaceName: "That name is too long." }));
    render(<EditWorkspaceDialog ws={summary()} onClose={vi.fn()} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("That name is too long.")).toBeInTheDocument();
    expect(screen.getByText("Please fix the name.")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("falls back to a generic message for unexpected errors", async () => {
    http.apiPatch.mockRejectedValueOnce(new Error("boom"));
    render(<EditWorkspaceDialog ws={summary()} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
  });

  it("shows progress and ignores a second submit while saving", async () => {
    http.apiPatch.mockReturnValue(new Promise(() => {}));
    render(<EditWorkspaceDialog ws={summary()} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    const saving = screen.getByRole("button", { name: "Saving…" });
    expect(saving).toBeDisabled();
    await userEvent.type(name(), "{Enter}");
    expect(http.apiPatch).toHaveBeenCalledTimes(1);
  });

  it("cancels without saving", async () => {
    const onClose = vi.fn();
    render(<EditWorkspaceDialog ws={summary()} onClose={onClose} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(http.apiPatch).not.toHaveBeenCalled();
  });
});

describe("DeleteWorkspaceDialog as the owner", () => {
  const remove = () => screen.getByRole("button", { name: "Delete workspace" });

  it("explains it's for everyone and needs the name typed exactly", async () => {
    render(<DeleteWorkspaceDialog ws={summary()} onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Delete workspace" })).toHaveTextContent("for all 3 members");
    expect(remove()).toBeDisabled();

    const confirm = screen.getByRole("textbox", { name: "Type “HQ” to confirm" });
    await userEvent.type(confirm, "hq");
    expect(remove()).toBeDisabled();
    await userEvent.clear(confirm);
    await userEvent.type(confirm, " HQ ");
    expect(remove()).toBeEnabled();
  });

  it("uses the singular for a workspace of one", () => {
    render(<DeleteWorkspaceDialog ws={summary({ memberCount: 1 })} onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("for all 1 member.");
  });

  it("deletes and reports back", async () => {
    const onDone = vi.fn();
    http.apiDelete.mockResolvedValue({});
    render(<DeleteWorkspaceDialog ws={summary({ workspaceId: "a b" })} onClose={vi.fn()} onDone={onDone} />);
    await userEvent.type(screen.getByRole("textbox"), "HQ");
    await userEvent.click(remove());

    expect(http.apiDelete).toHaveBeenCalledWith("/api/workspaces/a%20b");
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("shows the server's error and lets you try again", async () => {
    const onDone = vi.fn();
    http.apiDelete.mockRejectedValueOnce(new ApiError("Only the owner can delete this workspace.", 403));
    render(<DeleteWorkspaceDialog ws={summary()} onClose={vi.fn()} onDone={onDone} />);
    await userEvent.type(screen.getByRole("textbox"), "HQ");
    await userEvent.click(remove());

    expect(await screen.findByText("Only the owner can delete this workspace.")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(remove()).toBeEnabled();
  });

  it("shows progress while deleting", async () => {
    http.apiDelete.mockReturnValue(new Promise(() => {}));
    render(<DeleteWorkspaceDialog ws={summary()} onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox"), "HQ");
    await userEvent.click(remove());
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  });
});

describe("DeleteWorkspaceDialog as a member", () => {
  it("leaves without typing the name", async () => {
    const onDone = vi.fn();
    http.apiDelete.mockResolvedValue({});
    render(<DeleteWorkspaceDialog ws={summary({ role: "member" })} onClose={vi.fn()} onDone={onDone} />);

    expect(screen.getByRole("dialog", { name: "Leave workspace" })).toHaveTextContent("You can rejoin later with an invitation code.");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Leave workspace" }));

    expect(http.apiDelete).toHaveBeenCalledWith("/api/workspaces/ws1");
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("shows progress while leaving", async () => {
    http.apiDelete.mockReturnValue(new Promise(() => {}));
    render(<DeleteWorkspaceDialog ws={summary({ role: "admin" })} onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Leave workspace" }));
    expect(screen.getByRole("button", { name: "Leaving…" })).toBeDisabled();
  });
});

describe("MembersDialog", () => {
  it("shows the team for that workspace under its name", () => {
    render(<MembersDialog ws={summary()} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Members · HQ" })).toHaveTextContent("Team of ws1");
  });
});
