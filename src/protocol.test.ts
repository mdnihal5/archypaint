import { describe, expect, it } from "vitest";
import { protocolOf, withProtocol } from "./protocol";

describe("protocol label", () => {
  it("empty label becomes the bare name", () => { expect(withProtocol("", "Kafka")).toBe("Kafka"); });
  it("keeps a custom label after the prefix", () => { expect(withProtocol("orders", "Kafka")).toBe("Kafka · orders"); });
  it("picking another protocol replaces the prefix; repeat pick is stable", () => {
    expect(withProtocol("Kafka · orders", "SQL")).toBe("SQL · orders");
    expect(withProtocol("SQL · orders", "SQL")).toBe("SQL · orders");
    expect(withProtocol("HTTP", "gRPC")).toBe("gRPC");
  });
  it("none strips the prefix", () => {
    expect(withProtocol("Kafka · orders", null)).toBe("orders");
    expect(withProtocol("Kafka", null)).toBe("");
    expect(withProtocol("orders", null)).toBe("orders");
  });
  it("protocolOf needs the exact prefix", () => {
    expect(protocolOf("HTTP")).toBe("HTTP");
    expect(protocolOf("gRPC · x")).toBe("gRPC");
    expect(protocolOf("HTTPS")).toBeNull();
    expect(protocolOf("http")).toBeNull();
    expect(protocolOf("Kafka ·x")).toBeNull();
    expect(protocolOf("my Kafka")).toBeNull();
    expect(protocolOf("")).toBeNull();
  });
  it("cuts to the max length", () => { expect(withProtocol("x".repeat(300), "SQL", 200)).toHaveLength(200); });
});
