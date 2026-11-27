import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import * as service from "./lifeService";
import { NoticeBoard } from "./NoticeBoard";
import { OfficeStats } from "./OfficeStats";

// Keep the pure helpers (formatMinutes, ordinal, colours); replace every API call.
vi.mock("./lifeService", async (importOriginal) => {
  const real = await importOriginal<typeof import("./lifeService")>();
  return { ...real, getNotices: vi.fn(), addNotice: vi.fn(), updateNotice: vi.fn(), deleteNotice: vi.fn(), getStats: vi.fn() };
});

const api = vi.mocked(service);

const note = (over: Partial<service.Notice>): service.Notice => ({
  noticeId: "n1",
  text: "Standup at 10",
  color: "sun",
  pinned: false,
  authorName: "Olive",
  createdAt: "2026-11-20T10:00:00.000Z",
  updatedAt: "2026-11-20T10:00:00.000Z",
  ...over,
});

beforeEach(() => vi.resetAllMocks());

describe("NoticeBoard", () => {
  it("shows notes read-only to members", async () => {
    api.getNotices.mockResolvedValue({ notices: [note({ pinned: true }), note({ noticeId: "n2", text: "Pizza Friday" })], canEdit: false, max: 30 });
    render(<NoticeBoard workspaceId="ws1" />);
    const list = await screen.findByRole("list", { name: "Notes on the board" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Pizza Friday")).toBeInTheDocument();
    expect(screen.getByLabelText("Pinned")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "New note" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit note" })).not.toBeInTheDocument();
  });

  it("says so when the board is empty", async () => {
    api.getNotices.mockResolvedValue({ notices: [], canEdit: false, max: 30 });
    render(<NoticeBoard workspaceId="ws1" />);
    expect(await screen.findByText(/Nothing on the board yet/)).toBeInTheDocument();
  });

  it("lets the owner pin a new note and clears the form", async () => {
    api.getNotices.mockResolvedValue({ notices: [], canEdit: true, max: 30 });
    const added = note({ noticeId: "n9", text: "Lunch at 1", color: "sage", pinned: true });
    api.addNotice.mockResolvedValue({ notice: added, notices: [added] });
    render(<NoticeBoard workspaceId="ws1" />);
    const box = await screen.findByPlaceholderText(/Lunch at 1\?/);
    await userEvent.type(box, "  Lunch at 1 ");
    await userEvent.click(screen.getByRole("radio", { name: "Green" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Pin to the top" }));
    await userEvent.click(screen.getByRole("button", { name: "Pin to the board" }));
    expect(api.addNotice).toHaveBeenCalledWith("ws1", { text: "Lunch at 1", color: "sage", pinned: true });
    expect(await screen.findByText("Lunch at 1")).toBeInTheDocument();
    expect(box).toHaveValue("");
  });

  it("edits, pins and takes down notes", async () => {
    const n = note({});
    api.getNotices.mockResolvedValue({ notices: [n], canEdit: true, max: 30 });
    api.updateNotice.mockImplementation(async (_ws, _id, patch) => ({ notice: { ...n, ...patch }, notices: [{ ...n, ...patch }] }));
    api.deleteNotice.mockResolvedValue({ deleted: true, notices: [] });
    render(<NoticeBoard workspaceId="ws1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Pin note to the top" }));
    expect(api.updateNotice).toHaveBeenLastCalledWith("ws1", "n1", { pinned: true });
    expect(await screen.findByRole("button", { name: "Unpin note" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit note" }));
    const form = screen.getByRole("form", { name: "Edit note" });
    const text = within(form).getByRole("textbox");
    await userEvent.clear(text);
    await userEvent.type(text, "Standup at 11");
    await userEvent.click(within(form).getByRole("button", { name: "Save note" }));
    expect(api.updateNotice).toHaveBeenLastCalledWith("ws1", "n1", { text: "Standup at 11", color: "sun" });
    expect(await screen.findByText("Standup at 11")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Take note down" }));
    expect(api.deleteNotice).toHaveBeenCalledWith("ws1", "n1");
    expect(await screen.findByText(/The board is empty/)).toBeInTheDocument();
  });

  it("shows the server's message when a change fails", async () => {
    api.getNotices.mockResolvedValue({ notices: [note({})], canEdit: true, max: 30 });
    api.deleteNotice.mockRejectedValue(new ApiError("Only the workspace owner can change the notice board.", 403));
    render(<NoticeBoard workspaceId="ws1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Take note down" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the workspace owner");
    expect(screen.getByText("Standup at 10")).toBeInTheDocument();
  });

  it("stops adding when the board is full", async () => {
    api.getNotices.mockResolvedValue({ notices: [note({})], canEdit: true, max: 1 });
    render(<NoticeBoard workspaceId="ws1" />);
    expect(await screen.findByText(/The board is full/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pin to the board" })).toBeDisabled();
  });
});

describe("OfficeStats", () => {
  const counters = (over: Partial<service.MemberStats>): service.MemberStats => ({
    memberId: "m",
    displayName: "Someone",
    avatarId: "buddy-maya",
    focusing: false,
    you: false,
    coffees: 0,
    catPets: 0,
    focusMinutes: 0,
    ...over,
  });

  it("shows the office, you and the team", async () => {
    const you = counters({ memberId: "me", displayName: "Mia", you: true, coffees: 3, focusMinutes: 95 });
    const olive = counters({ memberId: "o", displayName: "Olive", catPets: 4, focusing: true, focusMinutes: 130 });
    api.getStats.mockResolvedValue({ office: { coffees: 5, catPets: 4, focusMinutes: 225 }, you, members: [olive, you] });
    render(<OfficeStats workspaceId="ws1" />);
    const office = await screen.findByRole("region", { name: "The whole office" });
    expect(within(office).getByText("3h 45m")).toBeInTheDocument();
    expect(within(office).getByText("5")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "You" })).getByText("1h 35m")).toBeInTheDocument();
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Olive");
    expect(within(rows[1]).getByLabelText("focusing now")).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent("Mia (you)");
  });

  it("shows an error if the stats can't load", async () => {
    api.getStats.mockRejectedValue(new ApiError("That workspace doesn't exist, or you're not a member.", 404));
    render(<OfficeStats workspaceId="ws1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("doesn't exist");
  });
});

describe("helpers", () => {
  it("formats minutes and ordinals", () => {
    expect(service.formatMinutes(0)).toBe("0m");
    expect(service.formatMinutes(61)).toBe("1h 1m");
    expect(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "102nd"]).toEqual([1, 2, 3, 4, 11, 12, 13, 21, 102].map(service.ordinal));
  });
});
