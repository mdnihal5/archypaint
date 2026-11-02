// Record keys of the one "docs" store. Kept apart from storage.ts so the lazy boards chunk can import them without
// depending on storage.ts (which pulls format.ts -> connectors.ts): with that import the bundler split connectors out
// of the entry into a second startup file.
export const INDEX = "boards";
export const bkey = (id: string, kind: "current" | "backup" | "view" | "handle"): string => `b:${id}:${kind}`;
export const newBoardId = (): string => `b${Math.random().toString(36).slice(2, 8)}`;
