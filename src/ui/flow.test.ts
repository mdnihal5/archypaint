import { describe, expect, it } from "vitest";
import { flows } from "./flow";
import { Scene } from "../scene";
import { sceneRectOf } from "../connectors";

describe("flow: which arrows animate", () => {
  const mk = () => {
    const s = new Scene();
    const a = s.add({ kind: "rect", x: 0, y: 0, w: 100, h: 60 }), b = s.add({ kind: "rect", x: 400, y: 0, w: 100, h: 60 }), m = s.add({ kind: "rect", x: 0, y: 200, w: 100, h: 60 });
    s.groups.set("g1", { id: "g1", name: "riders", cat: 0, collapsed: false, locked: false });
    s.groupRect = (id) => (id === "g1" ? { x: 0, y: 180, w: 120, h: 100 } : null);
    const arrow = (src: string, dst: string, head: 0 | 1 | 2 = 1) => s.add({ kind: "arrow", x: 0, y: 0, w: 1, h: 1, pts: [0, 0, 1, 1], src, dst, head });
    return { s, a, b, m, arrow };
  };
  it("shape to shape flows", () => { const { s, a, b, arrow } = mk(); expect(flows(sceneRectOf(s), arrow(a.id, b.id))).toBe(true); });
  it("a group on either end flows", () => {
    const { s, a, arrow } = mk();
    expect(flows(sceneRectOf(s), arrow("g1", a.id))).toBe(true); expect(flows(sceneRectOf(s), arrow(a.id, "g1"))).toBe(true); expect(flows(sceneRectOf(s), arrow("g1", "g1"))).toBe(true);
  });
  it("a branch end (host is another arrow) flows", () => { const { s, a, b, arrow } = mk(); const host = arrow(a.id, b.id); expect(flows(sceneRectOf(s), arrow(a.id, host.id))).toBe(true); });
  it("any element kind works as a target", () => {
    const { s, a, arrow } = mk();
    for (const kind of ["ellipse", "diamond", "text", "cylinder", "frame", "note", "image"] as const) {
      const t = s.add({ kind, x: 300, y: 300, w: 80, h: 60 });
      expect(flows(sceneRectOf(s), arrow(a.id, t.id))).toBe(true);
    }
  });
  it("open ends, deleted or empty groups, plain lines do not flow", () => {
    const { s, a, b, arrow } = mk();
    expect(flows(sceneRectOf(s), arrow(a.id, ""))).toBe(false); expect(flows(sceneRectOf(s), arrow(a.id, "gone"))).toBe(false);
    s.groups.set("g2", { id: "g2", name: "empty", cat: 0, collapsed: false, locked: false });
    expect(flows(sceneRectOf(s), arrow(a.id, "g2"))).toBe(false);
    expect(flows(sceneRectOf(s), arrow(a.id, b.id, 0))).toBe(false);
  });
});
