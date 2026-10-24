import { describe, expect, it } from "vitest";
import { evalCalc, MAX_LINE_CHARS, MAX_LINES } from "./calc";
import { CALC_TEMPLATES } from "./calc-templates";

describe("capacity-note templates", () => {
  it("there are the six starters the owner asked for", () => {
    expect(CALC_TEMPLATES.map((t) => t.id)).toEqual(["url-shortener", "chat", "news-feed", "video", "file-storage", "crud"]);
  });
  for (const t of CALC_TEMPLATES) {
    describe(t.title, () => {
      const rows = evalCalc(t.text);
      it("evaluates with zero errors and every line yields a value", () => {
        expect(rows.filter((r) => r.err).map((r) => `${r.name}: ${r.err}`)).toEqual([]);
        for (const r of rows) if (r.kind === "line") expect(r.value).not.toBeNull();
      });
      it("fits the calculator's limits", () => {
        const lines = t.text.split("\n");
        expect(lines.length).toBeLessThanOrEqual(MAX_LINES);
        for (const l of lines) expect(l.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
      });
      it("marks the assumptions as guesses, and each assumption is a plain `name = number` line", () => {
        const lines = t.text.split("\n");
        const a = lines.findIndex((l) => l.startsWith("# ASSUMPTIONS")), d = lines.findIndex((l) => l.startsWith("# DERIVED"));
        expect(a).toBeGreaterThan(-1); expect(d).toBeGreaterThan(a);
        expect(lines[a]).toMatch(/guesses, not facts/);
        const block = lines.slice(a + 1, d).filter((l) => l.trim() !== "");
        expect(block.length).toBeGreaterThanOrEqual(9);
        for (const l of block) expect(l).toMatch(/^[a-z_]+ = [0-9][0-9a-z.%*+ /]*$/i); // numbers and units only
        for (const l of block) expect(l.split("=")[1]).not.toMatch(/[a-z]+_[a-z_]+/i); // never derived from another named line
      });
      it("covers the quantities asked for: avg/peak read and write QPS, storage per day and retained with replication, in/egress, cache, servers", () => {
        const names = new Set(rows.map((r) => r.name));
        for (const n of ["avg_write_qps", "avg_read_qps", "peak_write_qps", "peak_read_qps", "storage_per_day", "storage_retained", "ingress_peak", "egress_peak", "cache_memory", "servers_needed", "replication_factor", "peak_factor", "retention_days", "read_write_ratio", "object_size", "dau"]) expect(names.has(n)).toBe(true);
      });
      it("results are sane: positive, finite, with the right kind of unit", () => {
        const by = new Map(rows.map((r) => [r.name, r]));
        expect(by.get("avg_read_qps")!.text).toMatch(/\/s$/);
        expect(by.get("storage_retained")!.text).toMatch(/[KMGTP]?B$/);
        expect(by.get("egress_peak")!.text).toMatch(/B\/s$/);
        expect(by.get("servers_needed")!.value!).toBeGreaterThanOrEqual(1);
        for (const r of rows) if (r.value !== null) expect(Number.isFinite(r.value) && r.value >= 0).toBe(true);
      });
    });
  }
  it("the URL shortener's derived key length is a small whole number", () => {
    const r = evalCalc(CALC_TEMPLATES[0]!.text).find((x) => x.name === "key_length_base62")!;
    expect(Number.isInteger(r.value)).toBe(true); expect(r.value!).toBeLessThan(12);
  });
});
