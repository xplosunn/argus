import { describe, expect, it } from "vitest";

import {
  assignDependencyEdgePorts,
  clearHiddenDependencySourceFilePathsForDirectory,
  countReferences,
  SHIKI_LANGS_FALLBACK,
  clampAnchorLine,
  compareFilesForSortMode,
  compareSymbols,
  countPatchLineTotals,
  countUsagesInDiff,
  filterDependencyGraphEdgesForHiddenSources,
  filterLocalSymbolsForTopLevel,
  fileNameForPath,
  fitDependencyGraphLayoutToBounds,
  folderForPath,
  formatLineNumber,
  getLineNumberColumnWidth,
  getBundledLanguageIds,
  getChangeKindForFile,
  getChangeKindForSymbolPure,
  getShikiLanguageCandidates,
  getTargetSelectionForSymbol,
  groupDirectoriesByDependencyRank,
  groupFilesByFolder,
  isLineInTargetSelection,
  markerForRowType,
  nextDependencyEdgeLaneMeta,
  normalizeChangeKind,
  normalizeSortMode,
  normalizeTargetSelection,
  parseRemovedEntryCounts,
  parseUnifiedPatch,
  pointsForDependencyEdge,
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

  it("ranks directories from their external dependencies instead of their earliest file", () => {
    const columns = groupDirectoriesByDependencyRank({
      nodes: [
        { id: "src/a.ts", filePath: "src/a.ts" },
        { id: "src/b.ts", filePath: "src/b.ts" },
        { id: "lib/c.ts", filePath: "lib/c.ts" }
      ],
      edges: [{ id: "src/b.ts->lib/c.ts", sourceFilePath: "src/b.ts", targetFilePath: "lib/c.ts" }]
    });

    expect(columns.map((directories) => directories.map((directory) => directory.path))).toEqual([["lib"], ["src"]]);
    expect(columns[1][0].nodes.map((node) => node.filePath)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("dumps every remaining directory into the next rank when dependencies are blocked", () => {
    const columns = groupDirectoriesByDependencyRank({
      nodes: [
        { id: "foundation/leaf.ts", filePath: "foundation/leaf.ts" },
        { id: "feature/app.ts", filePath: "feature/app.ts" },
        { id: "cycle-a/a.ts", filePath: "cycle-a/a.ts" },
        { id: "cycle-b/b.ts", filePath: "cycle-b/b.ts" },
        { id: "dependent/c.ts", filePath: "dependent/c.ts" }
      ],
      edges: [
        { id: "feature/app.ts->foundation/leaf.ts", sourceFilePath: "feature/app.ts", targetFilePath: "foundation/leaf.ts" },
        { id: "cycle-a/a.ts->cycle-b/b.ts", sourceFilePath: "cycle-a/a.ts", targetFilePath: "cycle-b/b.ts" },
        { id: "cycle-b/b.ts->cycle-a/a.ts", sourceFilePath: "cycle-b/b.ts", targetFilePath: "cycle-a/a.ts" },
        { id: "dependent/c.ts->cycle-a/a.ts", sourceFilePath: "dependent/c.ts", targetFilePath: "cycle-a/a.ts" }
      ]
    });

    expect(columns.map((directories) => directories.map((directory) => directory.path))).toEqual([
      ["foundation"],
      ["feature"],
      ["cycle-a", "cycle-b", "dependent"]
    ]);
  });

  it("hides only outgoing arrows for directories with hidden sources", () => {
    const visibleEdges = filterDependencyGraphEdgesForHiddenSources(
      [
        {
          id: "from-a-to-b",
          sourceDirectoryPath: "pkg/a",
          targetDirectoryPath: "pkg/b"
        },
        {
          id: "from-c-to-a",
          sourceDirectoryPath: "pkg/c",
          targetDirectoryPath: "pkg/a"
        },
        {
          id: "from-a-to-a",
          sourceDirectoryPath: "pkg/a",
          targetDirectoryPath: "pkg/a"
        }
      ],
      new Set(["pkg/a"])
    );

    expect(visibleEdges.map((edge) => edge.id)).toEqual(["from-c-to-a"]);
  });

  it("hides only outgoing arrows for files with hidden sources", () => {
    const visibleEdges = filterDependencyGraphEdgesForHiddenSources(
      [
        {
          id: "from-a-to-b",
          sourceFilePath: "pkg/a/from-a.ts",
          sourceDirectoryPath: "pkg/a",
          targetDirectoryPath: "pkg/b"
        },
        {
          id: "from-a-to-c",
          sourceFilePath: "pkg/a/from-c.ts",
          sourceDirectoryPath: "pkg/a",
          targetDirectoryPath: "pkg/c"
        },
        {
          id: "from-d-to-a",
          sourceFilePath: "pkg/d/from-d.ts",
          sourceDirectoryPath: "pkg/d",
          targetDirectoryPath: "pkg/a"
        }
      ],
      {
        directoryPaths: new Set(),
        filePaths: new Set(["pkg/a/from-a.ts"])
      }
    );

    expect(visibleEdges.map((edge) => edge.id)).toEqual(["from-a-to-c", "from-d-to-a"]);
  });

  it("clears hidden file sources when showing a directory again", () => {
    const hiddenFilePaths = clearHiddenDependencySourceFilePathsForDirectory(
      new Set(["pkg/a/from-a.ts", "pkg/a/from-b.ts", "pkg/c/from-c.ts", "root.ts"]),
      "pkg/a"
    );

    expect([...hiddenFilePaths]).toEqual(["pkg/c/from-c.ts", "root.ts"]);
  });

  it("balances same-column dependency edges across outer corridors", () => {
    const laneState = {
      columnOuterLaneCountsByKey: new Map(),
      gutterLaneCountsByKey: new Map()
    };
    const columnLayouts = [
      { index: 0, x: 28, width: 248 },
      { index: 1, x: 372, width: 248 },
      { index: 2, x: 716, width: 248 }
    ];
    const directory = {
      path: "src",
      x: 372,
      width: 248,
      columnIndex: 1
    };
    const source = { x: 386, y: 28, width: 220, height: 62 };
    const lowerTarget = { x: 386, y: 100, width: 220, height: 62 };
    const upperTarget = { x: 386, y: -44, width: 220, height: 62 };

    const firstLane = nextDependencyEdgeLaneMeta(source, directory, lowerTarget, directory, columnLayouts.length, laneState);
    expect(firstLane).toEqual({
      route: "same-column",
      side: "right",
      laneIndex: 0
    });
    expect(pointsForDependencyEdge(source, directory, lowerTarget, directory, columnLayouts, firstLane)).toEqual([
      { x: 606, y: 59 },
      { x: 638, y: 59 },
      { x: 638, y: 131 },
      { x: 606, y: 131 }
    ]);

    const secondLane = nextDependencyEdgeLaneMeta(source, directory, upperTarget, directory, columnLayouts.length, laneState);
    expect(secondLane).toEqual({
      route: "same-column",
      side: "left",
      laneIndex: 0
    });
    expect(pointsForDependencyEdge(source, directory, upperTarget, directory, columnLayouts, secondLane)).toEqual([
      { x: 386, y: 59 },
      { x: 354, y: 59 },
      { x: 354, y: -13 },
      { x: 386, y: -13 }
    ]);
  });

  it("shares gutter lanes across edges in the same column corridor", () => {
    const laneState = {
      columnOuterLaneCountsByKey: new Map(),
      gutterLaneCountsByKey: new Map()
    };
    const columnLayouts = [
      { index: 0, x: 28, width: 248 },
      { index: 1, x: 372, width: 248 },
      { index: 2, x: 716, width: 248 }
    ];
    const sourceDirectory = {
      path: "src/a",
      x: 28,
      width: 248,
      columnIndex: 0
    };
    const middleDirectory = {
      path: "src/b",
      x: 372,
      width: 248,
      columnIndex: 1
    };
    const farDirectory = {
      path: "src/c",
      x: 716,
      width: 248,
      columnIndex: 2
    };
    const source = { x: 42, y: 28, width: 220, height: 62 };
    const middleTarget = { x: 386, y: 100, width: 220, height: 62 };
    const farTarget = { x: 730, y: 172, width: 220, height: 62 };

    const firstLane = nextDependencyEdgeLaneMeta(source, sourceDirectory, farTarget, farDirectory, columnLayouts.length, laneState);
    expect(firstLane).toEqual({
      route: "cross-column",
      direction: "rightward",
      startGutterIndex: 0,
      endGutterIndex: 1,
      startLaneIndex: 0,
      endLaneIndex: 0
    });

    const secondLane = nextDependencyEdgeLaneMeta(source, sourceDirectory, middleTarget, middleDirectory, columnLayouts.length, laneState);
    expect(secondLane).toEqual({
      route: "cross-column",
      direction: "rightward",
      startGutterIndex: 0,
      endGutterIndex: 0,
      startLaneIndex: 1,
      endLaneIndex: 1
    });
    expect(pointsForDependencyEdge(source, sourceDirectory, middleTarget, middleDirectory, columnLayouts, secondLane)).toEqual([
      { x: 262, y: 59 },
      { x: 336, y: 59 },
      { x: 336, y: 131 },
      { x: 386, y: 131 }
    ]);
  });

  it("separates incoming and outgoing file ports on the same side", () => {
    const columnLayouts = [
      { index: 0, x: 28, width: 248 },
      { index: 1, x: 372, width: 248 },
      { index: 2, x: 716, width: 248 }
    ];
    const sharedDirectory = {
      path: "src/shared",
      x: 372,
      width: 248,
      columnIndex: 1
    };
    const rightDirectory = {
      path: "src/right",
      x: 716,
      width: 248,
      columnIndex: 2
    };
    const sharedNode = { id: "shared", x: 386, y: 28, width: 220, height: 62 };
    const upperRightNode = { id: "upper", x: 730, y: -44, width: 220, height: 62 };
    const lowerRightNode = { id: "lower", x: 730, y: 172, width: 220, height: 62 };
    const edgeDrafts = [
      {
        edge: { id: "shared->upper" },
        source: sharedNode,
        target: upperRightNode,
        sourceDirectory: sharedDirectory,
        targetDirectory: rightDirectory,
        laneMeta: {
          route: "cross-column",
          direction: "rightward",
          startGutterIndex: 1,
          endGutterIndex: 1,
          startLaneIndex: 0,
          endLaneIndex: 0
        }
      },
      {
        edge: { id: "lower->shared" },
        source: lowerRightNode,
        target: sharedNode,
        sourceDirectory: rightDirectory,
        targetDirectory: sharedDirectory,
        laneMeta: {
          route: "cross-column",
          direction: "leftward",
          startGutterIndex: 1,
          endGutterIndex: 1,
          startLaneIndex: 0,
          endLaneIndex: 0
        }
      }
    ];

    const edgePorts = assignDependencyEdgePorts(edgeDrafts);
    expect(edgePorts[0]).toEqual({
      sourcePortIndex: 0,
      sourcePortCount: 2,
      targetPortIndex: 0,
      targetPortCount: 1
    });
    expect(edgePorts[1]).toEqual({
      sourcePortIndex: 0,
      sourcePortCount: 1,
      targetPortIndex: 1,
      targetPortCount: 2
    });

    const outgoingPoints = pointsForDependencyEdge(
      sharedNode,
      sharedDirectory,
      upperRightNode,
      rightDirectory,
      columnLayouts,
      edgeDrafts[0].laneMeta,
      edgePorts[0]
    );
    const incomingPoints = pointsForDependencyEdge(
      lowerRightNode,
      rightDirectory,
      sharedNode,
      sharedDirectory,
      columnLayouts,
      edgeDrafts[1].laneMeta,
      edgePorts[1]
    );

    expect(outgoingPoints[0]).toMatchObject({ x: 606 });
    expect(incomingPoints[incomingPoints.length - 1]).toMatchObject({ x: 606 });
    expect(outgoingPoints[0].y).toBeLessThan(incomingPoints[incomingPoints.length - 1].y);
  });

  it("expands and shifts dependency graph layouts to keep left-overflowing edges visible", () => {
    const fitted = fitDependencyGraphLayoutToBounds({
      width: 320,
      height: 220,
      directories: [{ id: "src", path: "src", x: 28, y: 28, width: 248, height: 104 }],
      nodes: [{ id: "src/a.ts", filePath: "src/a.ts", x: 42, y: 56, width: 220, height: 62 }],
      edges: [{ id: "edge", points: [{ x: -12, y: 87 }, { x: 42, y: 87 }] }]
    });

    expect(fitted.width).toBe(360);
    expect(fitted.directories[0].x).toBe(68);
    expect(fitted.nodes[0].x).toBe(82);
    expect(fitted.edges[0].points[0]).toEqual({ x: 28, y: 87 });
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
