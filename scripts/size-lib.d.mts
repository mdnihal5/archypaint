export function htmlJs(html: string): string[];
export function staticImports(code: string): string[];
export function startupFrom(html: string, read: (file: string) => Uint8Array): Array<{ file: string; gz: number }>;
export function startupSet(dist: string): Array<{ file: string; gz: number }>;
