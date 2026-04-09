import { describe, expect, it } from "vitest";

import {
  countReferences,
  SHIKI_LANGS_FALLBACK,
  clampAnchorLine,
  compareFilesForSortMode,
  compareSymbols,
  countPatchLineTotals,
  countUsagesInDiff,
  filterLocalSymbolsForTopLevel,
  fileNameForPath,
  folderForPath,
  formatLineNumber,
  getLineNumberColumnWidth,
  getBundledLanguageIds,
  getChangeKindForFile,
  getChangeKindForSymbolPure,
  getShikiLanguageCandidates,
  getTargetSelectionForSymbol,
  groupFilesByFolder,
  isLineInTargetSelection,
  markerForRowType,
  normalizeChangeKind,
  normalizeSortMode,
  normalizeTargetSelection,
  parseRemovedEntryCounts,
  parseUnifiedPatch,
  resolveShikiLanguageIdsForCurrentDiff
} from "./logic.js";

function makeSymbol(overrides = {}) {
  return {
    id: "sym",
    name: "sym",
    kind: "function",
    declaration: { filePath: "src/a.ts", line: 5, column: 1 },
    selectionRange: { startLine: 5, endLine: 8 },
    isDeclarationInDiff: true,
    ...overrides
  };
}

describe("web-client logic helpers", () => {
  it("normalizes target selection shapes", () => {
    expect(normalizeTargetSelection(3.9)).toEqual({ startLine: 3, endLine: 3, focusLine: 3 });
    expect(normalizeTargetSelection({ startLine: 7, endLine: 9, focusLine: 8 })).toEqual({
      startLine: 7,
      endLine: 9,
      focusLine: 8,
      includeRemovedRows: false,
      includeCurrentRows: true
    });
    expect(normalizeTargetSelection("bad")).toBeNull();
  });

  it("checks line-in-selection inclusively", () => {
    const selection = { startLine: 10, endLine: 12 };
    expect(isLineInTargetSelection(9, selection)).toBe(false);
    expect(isLineInTargetSelection(10, selection)).toBe(true);
    expect(isLineInTargetSelection(12, selection)).toBe(true);
    expect(isLineInTargetSelection(13, selection)).toBe(false);
  });

  it("builds symbol target selections that keep removed rows in the same block", () => {
    expect(getTargetSelectionForSymbol(makeSymbol())).toEqual({
      startLine: 5,
      endLine: 8,
      focusLine: 5,
      includeRemovedRows: true,
      includeCurrentRows: true
    });

    expect(
      getTargetSelectionForSymbol(
        makeSymbol({
          id: "removed:src/a.ts:5:0",
          name: "2 lines removed, 3 lines added",
          selectionRange: { startLine: 5, endLine: 5 }
        })
      )
    ).toEqual({
      startLine: 5,
      endLine: 7,
      focusLine: 5,
      includeRemovedRows: true,
      includeCurrentRows: true
    });

    expect(
      getTargetSelectionForSymbol(
        makeSymbol({
          id: "removed:src/a.ts:5:1",
          name: "2 lines removed",
          selectionRange: { startLine: 5, endLine: 5 }
        })
      )
    ).toEqual({
      startLine: 5,
      endLine: 5,
      focusLine: 5,
      includeRemovedRows: true,
      includeCurrentRows: false
    });
  });

  it("selects shiki ids and language candidates", () => {
    const bundledFromArray = getBundledLanguageIds({
      bundledLanguages: [{ id: "ts" }, { name: "tsx" }, "js"]
    });
    expect(bundledFromArray).toEqual(["ts", "tsx", "js"]);

    const bundledFromObject = getBundledLanguageIds({
      bundledLanguages: { ts: {}, css: {} }
    });
    expect(bundledFromObject).toEqual(["ts", "css"]);

    expect(getShikiLanguageCandidates("src/file.cts")).toEqual(["cts", "ts"]);
    expect(getShikiLanguageCandidates("Dockerfile")).toEqual(["dockerfile", "docker"]);
    expect(getShikiLanguageCandidates(".eslintrc")).toEqual(["eslintrc"]);

    expect(resolveShikiLanguageIdsForCurrentDiff(["ts", "js", "css"], ["css", "yaml"])).toEqual(["css"]);
    expect(resolveShikiLanguageIdsForCurrentDiff(["json"], ["yaml"])).toEqual(["json"]);
    expect(resolveShikiLanguageIdsForCurrentDiff([], ["ts"])).toEqual(SHIKI_LANGS_FALLBACK);
  });

  it("parses unified patch rows", () => {
    const patch = [
      "diff --git a/a.ts b/a.ts",
      "@@ -1,2 +1,3 @@",
      " context",
      "-old",
      "+new",
      "+new2",
      "\\ No newline at end of file"
    ].join("\n");

    const rows = parseUnifiedPatch(patch);
    expect(rows.map((row) => ({ type: row.type, oldLine: row.oldLine, newLine: row.newLine, anchor: row.anchorNewLine }))).toEqual(
      [
        { type: "hunk", oldLine: null, newLine: null, anchor: null },
        { type: "context", oldLine: 1, newLine: 1, anchor: null },
        { type: "removed", oldLine: 2, newLine: null, anchor: 2 },
        { type: "added", oldLine: null, newLine: 2, anchor: null },
        { type: "added", oldLine: null, newLine: 3, anchor: null },
        { type: "meta", oldLine: null, newLine: null, anchor: null }
      ]
    );
    expect(countPatchLineTotals(patch)).toEqual({ added: 2, removed: 1 });
    expect(countPatchLineTotals(null)).toEqual({ added: 0, removed: 0 });
  });

  it("formats rows and groups folders", () => {
    expect(markerForRowType("added")).toBe("+");
    expect(markerForRowType("removed")).toBe("-");
    expect(markerForRowType("hunk")).toBe("@");
    expect(markerForRowType("meta")).toBe("!");
    expect(markerForRowType("context")).toBe(" ");
    expect(formatLineNumber(null)).toBe("");
    expect(formatLineNumber(7)).toBe("   7");
    expect(getLineNumberColumnWidth([7, 42, 105])).toBe(3);
    expect(getLineNumberColumnWidth([null, "bad"], 2)).toBe(2);
    expect(clampAnchorLine(null, 4)).toBe(5);
    expect(clampAnchorLine(0, 4)).toBe(1);
    expect(clampAnchorLine(9, 4)).toBe(5);

    expect(fileNameForPath("a.ts")).toBe("a.ts");
    expect(fileNameForPath("src/nested/a.ts")).toBe("a.ts");
    expect(folderForPath("a.ts")).toBe(".");
    expect(folderForPath("src/a.ts")).toBe("src");
    const grouped = groupFilesByFolder([{ path: "src/b.ts" }, { path: "a.ts" }, { path: "src/a.ts" }]);
    expect(grouped.map((entry) => entry.folder)).toEqual([".", "src"]);
    expect(grouped[1].files.map((entry) => entry.path)).toEqual(["src/b.ts", "src/a.ts"]);
  });

  it("classifies change kinds for files and symbols", () => {
    expect(getChangeKindForFile({ status: "added" })).toBe("added");
    expect(getChangeKindForFile({ status: "deleted" })).toBe("removed");
    expect(getChangeKindForFile({ status: "modified" })).toBe("modified");
    expect(parseRemovedEntryCounts("2 lines removed, 4 lines added")?.added).toBe(4);
    expect(parseRemovedEntryCounts("4 lines added")?.added).toBe(4);
    expect(parseRemovedEntryCounts("2 lines removed")?.removed).toBe(2);
    expect(parseRemovedEntryCounts("bad")).toBeNull();

    const removedSymbol = makeSymbol({
      id: "removed:src/a.ts:5:0",
      name: "2 lines removed"
    });
    expect(getChangeKindForSymbolPure(removedSymbol, null, [])).toBe("removed");

    const symbolInAddedFile = makeSymbol();
    expect(getChangeKindForSymbolPure(symbolInAddedFile, { status: "added" }, [])).toBe("added");

    const symbolWithAddedOnly = makeSymbol({ isDeclarationInDiff: true });
    expect(
      getChangeKindForSymbolPure(symbolWithAddedOnly, { status: "modified" }, [{ type: "added", newLine: 6, anchorNewLine: null }])
    ).toBe("added");

    const symbolNotInDiffButChangedInside = makeSymbol({ isDeclarationInDiff: false });
    expect(
      getChangeKindForSymbolPure(symbolNotInDiffButChangedInside, { status: "modified" }, [
        { type: "added", newLine: 6, anchorNewLine: null }
      ])
    ).toBe("modified");

    const symbolWithRemovedInside = makeSymbol();
    expect(
      getChangeKindForSymbolPure(symbolWithRemovedInside, { status: "modified" }, [{ type: "removed", anchorNewLine: 6, newLine: null }])
    ).toBe("modified");
  });

  it("hides synthetic line-count children under added top-level symbols", () => {
    const topLevelSymbol = makeSymbol({
      id: "top",
      scope: "top-level",
      topLevelSymbolId: null
    });
    const syntheticLocalSymbol = makeSymbol({
      id: "removed:src/a.ts:5:0",
      name: "7 lines added",
      kind: "unknown",
      scope: "local",
      topLevelSymbolId: "top"
    });
    const realLocalSymbol = makeSymbol({
      id: "nested",
      name: "nested",
      kind: "function",
      scope: "local",
      topLevelSymbolId: "top"
    });

    expect(
      filterLocalSymbolsForTopLevel(
        [syntheticLocalSymbol, realLocalSymbol],
        topLevelSymbol,
        { status: "modified" },
        [{ type: "added", newLine: 6, anchorNewLine: null }]
      )
    ).toEqual([realLocalSymbol]);

    expect(
      filterLocalSymbolsForTopLevel(
        [syntheticLocalSymbol, realLocalSymbol],
        makeSymbol({
          id: "top",
          scope: "top-level",
          topLevelSymbolId: null,
          isDeclarationInDiff: false
        }),
        { status: "modified" },
        [{ type: "added", newLine: 6, anchorNewLine: null }]
      )
    ).toEqual([syntheticLocalSymbol, realLocalSymbol]);
  });

  it("sorts and counts usage-based values", () => {
    expect(normalizeChangeKind("added")).toBe("added");
    expect(normalizeChangeKind("invalid")).toBeNull();
    expect(normalizeSortMode("usages")).toBe("usages");
    expect(normalizeSortMode("anything")).toBe("alphabetical");

    const usageCountByFile = new Map([
      ["src/a.ts", 3],
      ["src/b.ts", 1]
    ]);
    const getUsageCount = (filePath: string) => usageCountByFile.get(filePath) ?? Number.POSITIVE_INFINITY;
    expect(compareFilesForSortMode("src/a.ts", "src/b.ts", "usages", getUsageCount)).toBeGreaterThan(0);
    expect(compareFilesForSortMode("src/a.ts", "src/b.ts", "alphabetical", getUsageCount)).toBeLessThan(0);

    const symbols = [
      { declaration: { filePath: "b.ts", line: 1, column: 1 } },
      { declaration: { filePath: "a.ts", line: 2, column: 1 } },
      { declaration: { filePath: "a.ts", line: 2, column: 0 } }
    ];
    symbols.sort(compareSymbols);
    expect(symbols.map((symbol) => `${symbol.declaration.filePath}:${symbol.declaration.line}:${symbol.declaration.column}`)).toEqual([
      "a.ts:2:0",
      "a.ts:2:1",
      "b.ts:1:1"
    ]);

    expect(countUsagesInDiff([{ isInDiff: true }, { isInDiff: false }, { isInDiff: true }])).toBe(2);
    expect(countReferences([{ isDefinition: true }, { isDefinition: false }, { isDefinition: false }])).toBe(2);
    expect(countReferences([{ isDefinition: true }])).toBe(0);
  });
});
