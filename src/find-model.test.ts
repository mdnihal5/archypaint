import { describe, expect, it } from "vitest";
import { FindIndex } from "./find-model";
import { Scene } from "./scene";

function build() {
  const sc = new Scene();
  const api = sc.add({ kind: "rect", text: "Payments API" });
  const db = sc.add({ kind: "cylinder", text: "orders db" });
  const ic = sc.add({ kind: "icon", iconId: "read-replica", text: "" });
  const ar = sc.add({ kind: "arrow", text: "gRPC call" });
  const ln = sc.add({ kind: "lane", text: "Client\nGateway" });
  sc.add({ kind: "rect", text: "" });
  sc.groups.set("g1", { id: "g1", name: "Data tier", cat: 0, collapsed: false, locked: false });
  sc.patch(db, { groupIds: ["g1"] }); sc.patch(ic, { groupIds: ["g1"] });
  return { sc, api, db, ic, ar, ln };
}

describe("find index", () => {
  it("matches labels case-insensitively, all tokens required", () => {
    const { sc, api } = build();
    const f = new FindIndex(sc);
    expect(f.search("payments").map((m) => m.ids[0])).toEqual([api.id]);
    expect(f.search("PAYMENTS api")).toHaveLength(1);
    expect(f.search("payments xyz")).toHaveLength(0);
    expect(f.search("   ")).toHaveLength(0);
  });
  it("finds icon names (from the id), arrow labels and lane names", () => {
    const { sc, ic, ar, ln } = build();
    const f = new FindIndex(sc);
    expect(f.search("read replica")[0]!.ids).toEqual([ic.id]);
    expect(f.search("grpc")[0]!.ids).toEqual([ar.id]);
    expect(f.search("gateway")[0]!.ids).toEqual([ln.id]);
  });
  it("a group-name match covers every member", () => {
    const { sc, db, ic } = build();
    const m = new FindIndex(sc).search("data tier");
    expect(m).toHaveLength(1);
    expect([...m[0]!.ids].sort()).toEqual([db.id, ic.id].sort());
  });
  it("picks up changes to the scene (index rebuilt lazily per scene version)", () => {
    const { sc, api } = build();
    const f = new FindIndex(sc);
    expect(f.search("billing")).toHaveLength(0);
    sc.patch(api, { text: "Billing service" });
    expect(f.search("billing")[0]!.ids).toEqual([api.id]);
    sc.remove(api);
    expect(f.search("billing")).toHaveLength(0);
  });
  it("respects the result limit and stays fast on 5,000 elements", () => {
    const sc = new Scene();
    for (let i = 0; i < 5000; i++) sc.add({ kind: "rect", text: `service-${i}` });
    const f = new FindIndex(sc);
    f.search("service");
    const t = performance.now();
    const all = f.search("service-4", 5000);
    expect(performance.now() - t).toBeLessThan(50);
    expect(all.length).toBe(1111);
    expect(f.search("service", 10)).toHaveLength(10);
  });
});
