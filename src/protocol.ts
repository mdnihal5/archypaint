/** Arrow protocol = label prefix + the dash flag. Nothing is stored: "Kafka · orders" is just text. */
export const PROTOCOLS = ["HTTP", "gRPC", "Kafka", "SQL"] as const;
export type Protocol = (typeof PROTOCOLS)[number];
/** async protocols draw dashed */
export const dashFor = (p: Protocol | null): 0 | 1 => (p === "Kafka" ? 1 : 0);

/** the protocol a label starts with ("Kafka" or "Kafka · …"), else null */
export function protocolOf(text: string): Protocol | null {
  for (const p of PROTOCOLS) if (text === p || text.startsWith(p + " · ")) return p;
  return null;
}

/** `text` with its protocol prefix replaced by `proto` (null strips it); the custom part is kept, the result is cut to `max` */
export function withProtocol(text: string, proto: Protocol | null, max = 200): string {
  const cur = protocolOf(text);
  const base = cur === null ? text : text.slice(cur.length + 3);
  if (proto === null) return base;
  return (base ? `${proto} · ${base}` : proto).slice(0, max);
}
