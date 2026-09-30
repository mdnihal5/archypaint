import { describe, expect, it } from "vitest";
import { fileKindFromName, safeFileName, sniffKind, stripExt } from "./file";

describe("file helpers", () => {
  it("detects the kind from the extension, then from content", () => {
    expect(fileKindFromName("A.ARCHYPAINT")).toBe("archypaint");
    expect(fileKindFromName("x.excalidraw")).toBe("excalidraw");
    expect(fileKindFromName("x.json")).toBe("unknown");
    expect(sniffKind('{"type":"excalidraw","version":2}')).toBe("excalidraw");
    expect(sniffKind('{\n"app":"archypaint",\n"version":1}')).toBe("archypaint");
    expect(sniffKind("hello")).toBe("unknown");
  });
  it("strips extensions and builds safe download names", () => {
    expect(stripExt("plan.archypaint")).toBe("plan");
    expect(stripExt(".json")).toBe("untitled");
    expect(safeFileName("a/b\\c:d", "png")).toBe("a-b-c-d.png");
    expect(safeFileName("x".repeat(500), "png").length).toBeLessThanOrEqual(104);
  });
});
