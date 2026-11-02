import { describe, expect, it } from "vitest";
import { filterBoards, relTime } from "./boards-model";

const at = (s: string) => new Date(s).getTime();
describe("relTime", () => {
  const now = at("2026-10-20T15:00:00");
  it("is relative for today, then Yesterday, N days, and a date", () => {
    expect(relTime(now - 10_000, now)).toBe("just now");
    expect(relTime(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(relTime(now - 2 * 3_600_000, now)).toBe("2 h ago");
    expect(relTime(at("2026-10-19T09:00:00"), now)).toBe("Yesterday");
    expect(relTime(at("2026-10-17T09:00:00"), now)).toBe("3 days ago");
    expect(relTime(at("2026-10-12T09:00:00"), now)).toBe("Oct 12");
    expect(relTime(at("2025-03-02T09:00:00"), now)).toBe("Mar 2, 2025");
  });
});
describe("filterBoards", () => {
  it("matches case-insensitively and keeps order", () => {
    const r = [{ name: "Checkout flow" }, { name: "Search" }, { name: "checkpoint" }];
    expect(filterBoards(r, " CHECK ").map((x) => x.name)).toEqual(["Checkout flow", "checkpoint"]);
    expect(filterBoards(r, "")).toHaveLength(3);
  });
});
