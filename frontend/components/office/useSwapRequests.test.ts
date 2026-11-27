import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as service from "@/components/team/service";
import { SWAP_POLL_MS, useSwapRequests } from "./useSwapRequests";

vi.mock("@/components/team/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/team/service")>()),
  getSwapRequests: vi.fn(),
}));
const api = vi.mocked(service);

const request = (requestId: string, direction: "incoming" | "outgoing", name = "Bob"): service.DeskRequest => ({
  requestId,
  direction,
  from: { memberId: name.toLowerCase(), displayName: name, desk: 2 },
  to: { memberId: "olive", displayName: "Olive", desk: 1 },
  createdAt: "2026-11-28T10:00:00Z",
});

/** Let pending promises settle inside act. */
const flush = () => act(async () => {});

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSwapRequests", () => {
  it("keeps only requests waiting for the viewer's answer", async () => {
    api.getSwapRequests.mockResolvedValue({ requests: [request("r1", "incoming"), request("r2", "outgoing"), request("r3", "incoming", "Cat")] });
    const { result } = renderHook(() => useSwapRequests("ws1"));
    await flush();

    expect(api.getSwapRequests).toHaveBeenCalledWith("ws1");
    expect(result.current.waiting.map((r) => r.requestId)).toEqual(["r1", "r3"]);
  });

  it("does nothing without a saved workspace", async () => {
    const { result } = renderHook(() => useSwapRequests(undefined));
    await flush();
    expect(api.getSwapRequests).not.toHaveBeenCalled();
    expect(result.current.waiting).toEqual([]);
  });

  it("checks again every 30 s while the tab is visible, and not while it's hidden", async () => {
    api.getSwapRequests.mockResolvedValue({ requests: [] });
    renderHook(() => useSwapRequests("ws1"));
    await flush();
    expect(api.getSwapRequests).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(SWAP_POLL_MS));
    expect(api.getSwapRequests).toHaveBeenCalledTimes(2);

    visibility = "hidden";
    await act(() => vi.advanceTimersByTimeAsync(SWAP_POLL_MS * 3));
    expect(api.getSwapRequests).toHaveBeenCalledTimes(2);

    // Coming back to the tab checks straight away.
    visibility = "visible";
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    expect(api.getSwapRequests).toHaveBeenCalledTimes(3);
  });

  it("tells the caller only about requests it hasn't seen before", async () => {
    const onNew = vi.fn();
    api.getSwapRequests.mockResolvedValueOnce({ requests: [request("r1", "incoming")] });
    const { result } = renderHook(() => useSwapRequests("ws1", onNew));
    await flush();
    expect(onNew).toHaveBeenLastCalledWith([expect.objectContaining({ requestId: "r1" })]);

    // Same request again: no new news.
    api.getSwapRequests.mockResolvedValueOnce({ requests: [request("r1", "incoming")] });
    await act(() => result.current.refresh());
    expect(onNew).toHaveBeenCalledTimes(1);

    // A second person asks.
    api.getSwapRequests.mockResolvedValueOnce({ requests: [request("r1", "incoming"), request("r4", "incoming", "Cat")] });
    await act(() => result.current.refresh());
    expect(onNew).toHaveBeenCalledTimes(2);
    expect(onNew).toHaveBeenLastCalledWith([expect.objectContaining({ requestId: "r4" })]);
    expect(result.current.waiting).toHaveLength(2);
  });

  it("clears the badge once requests are answered", async () => {
    api.getSwapRequests.mockResolvedValueOnce({ requests: [request("r1", "incoming")] });
    const { result } = renderHook(() => useSwapRequests("ws1"));
    await flush();
    expect(result.current.waiting).toHaveLength(1);

    api.getSwapRequests.mockResolvedValueOnce({ requests: [] });
    await act(() => result.current.refresh());
    expect(result.current.waiting).toEqual([]);
  });

  it("keeps the last count when a check fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    api.getSwapRequests.mockResolvedValueOnce({ requests: [request("r1", "incoming")] });
    const { result } = renderHook(() => useSwapRequests("ws1"));
    await flush();

    api.getSwapRequests.mockRejectedValueOnce(new Error("offline"));
    await act(() => result.current.refresh());
    expect(result.current.waiting).toHaveLength(1);
    expect(log).toHaveBeenCalled();
  });

  it("stops checking once unmounted", async () => {
    api.getSwapRequests.mockResolvedValue({ requests: [] });
    const { unmount } = renderHook(() => useSwapRequests("ws1"));
    await flush();
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(SWAP_POLL_MS * 2));
    expect(api.getSwapRequests).toHaveBeenCalledTimes(1);
  });
});
