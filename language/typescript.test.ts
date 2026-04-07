import path from "node:path";

import { describe, expect, it } from "vitest";

import { __internal as tsInternal, isTypeScriptSupportedFile } from "./typescript.ts";

describe("language/typescript internals", () => {
  it("matches supported script extensions", () => {
    expect(isTypeScriptSupportedFile("a.ts")).toBe(true);
    expect(isTypeScriptSupportedFile("a.tsx")).toBe(true);
    expect(isTypeScriptSupportedFile("a.mts")).toBe(true);
    expect(isTypeScriptSupportedFile("a.cjs")).toBe(true);
    expect(isTypeScriptSupportedFile("a.css")).toBe(false);
    expect(isTypeScriptSupportedFile("a.md")).toBe(false);
  });

  it("evaluates line range inclusion and overlap", () => {
    const ranges = [
      { startLine: 2, endLine: 4 },
      { startLine: 8, endLine: 9 }
    ];

    expect(tsInternal.lineInRanges(1, ranges)).toBe(false);
    expect(tsInternal.lineInRanges(2, ranges)).toBe(true);
    expect(tsInternal.lineInRanges(9, ranges)).toBe(true);
    expect(tsInternal.intersectsRanges(1, 1, ranges)).toBe(false);
    expect(tsInternal.intersectsRanges(1, 2, ranges)).toBe(true);
    expect(tsInternal.intersectsRanges(5, 7, ranges)).toBe(false);
    expect(tsInternal.intersectsRanges(7, 8, ranges)).toBe(true);
  });

  it("encodes symbol ids as stable payloads", () => {
    const encoded = tsInternal.encodeSymbolId("src/a.ts", 1234);
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    expect(decoded).toEqual({ filePath: "src/a.ts", position: 1234 });
  });

  it("normalizes repo-relative paths", () => {
    const repoRoot = path.resolve("/tmp", "repo");
    const absoluteFile = path.resolve(repoRoot, "src\\nested\\file.ts");

    expect(tsInternal.normalizePath("src\\a\\b.ts")).toBe("src/a/b.ts");
    expect(tsInternal.toRepoPath(repoRoot, absoluteFile)).toBe("src/nested/file.ts");
  });
});
