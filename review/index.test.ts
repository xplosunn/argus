import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createReviewSession, __internal as reviewInternal } from "./index.ts";

function makeSymbol(overrides = {}) {
  return {
    id: "sym",
    name: "sym",
    kind: "function",
    declaration: {
      filePath: "src/a.ts",
      line: 1,
      column: 1
    },
    selectionRange: {
      startLine: 1,
      endLine: 1
    },
    isDeclarationInDiff: true,
    scope: "top-level",
    topLevelSymbolId: null,
    ...overrides
  };
}

describe("review/index internals", () => {
  it("refuses branch reviews when uncommitted changes are present and suggests the override flag", () => {
    const { repoRoot, cleanup } = createTempRepo();

    try {
      writeRepoFile(repoRoot, "src/app.ts", "export const value = 1;\n");
      git(repoRoot, ["add", "."]);
      git(repoRoot, ["commit", "-m", "initial"]);
      git(repoRoot, ["checkout", "-b", "feature/editor"]);

      writeRepoFile(repoRoot, "src/app.ts", "export const value = 2;\n");
      git(repoRoot, ["commit", "-am", "feature change"]);

      writeRepoFile(repoRoot, "src/app.ts", "export const value = 3;\n");

      expect(() => createReviewSession({ repoRoot, defaultBranch: "main" })).toThrow(
        "Argus won't review main...HEAD while uncommitted changes are present on feature/editor. Commit or stash them first, or rerun with --default-branch feature/editor to review the uncommitted changes on your current branch instead."
      );
    } finally {
      cleanup();
    }
  });

  it("allows reviewing uncommitted changes when the override points to the current branch", () => {
    const { repoRoot, cleanup } = createTempRepo();

    try {
      writeRepoFile(repoRoot, "src/app.ts", "export const value = 1;\n");
      git(repoRoot, ["add", "."]);
      git(repoRoot, ["commit", "-m", "initial"]);
      git(repoRoot, ["checkout", "-b", "feature/editor"]);

      writeRepoFile(repoRoot, "src/app.ts", "export const value = 2;\n");

      const session = createReviewSession({
        repoRoot,
        defaultBranch: "feature/editor"
      });

      expect(session.bootstrap.review.mode).toBe("working-tree");
      expect(session.bootstrap.files.map((file) => file.path)).toEqual(["src/app.ts"]);
    } finally {
      cleanup();
    }
  });

  it("groups removed and added runs by hunk anchor", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "@@ -10,3 +10,4 @@",
      "-old1",
      "-old2",
      "+new1",
      "+new2",
      " context",
      "@@ -20,0 +22,2 @@",
      "+only",
      "+add",
      "@@ -30,2 +34,0 @@",
      "-gone1",
      "-gone2"
    ].join("\n");

    const chunks = reviewInternal.parseRemovedChunks(patch);
    expect(chunks).toEqual([
      { anchorLine: 10, removedLineCount: 2, addedLineCount: 2 },
      { anchorLine: 22, removedLineCount: 0, addedLineCount: 2 },
      { anchorLine: 34, removedLineCount: 2, addedLineCount: 0 }
    ]);
  });

  it("handles declaration-start containment based on followed additions", () => {
    const containing = makeSymbol({
      id: "top",
      selectionRange: { startLine: 5, endLine: 10 }
    });

    expect(reviewInternal.findContainingSymbol([containing], 7, false)?.id).toBe("top");
    expect(reviewInternal.findContainingSymbol([containing], 5, false)).toBeNull();
    expect(reviewInternal.findContainingSymbol([containing], 5, true)?.id).toBe("top");
    expect(reviewInternal.findContainingSymbol([containing], 11, true)).toBeNull();
  });

  it("adds fallback symbols only for unsupported files without symbols", () => {
    const changedFiles = [
      {
        path: "src/styles.css",
        status: "modified",
        changedRanges: [{ startLine: 4, endLine: 6 }],
        content: "a\nb\nc\n",
        patch: null
      },
      {
        path: "src/app.ts",
        status: "modified",
        changedRanges: [{ startLine: 2, endLine: 2 }],
        content: "const x = 1\n",
        patch: null
      }
    ];
    const existing = [makeSymbol({ declaration: { filePath: "src/other.css", line: 1, column: 1 } })];

    const fallback = reviewInternal.buildUnsupportedFileSymbols(changedFiles, existing);
    expect(
      fallback.map((symbol) => ({
        id: symbol.id,
        file: symbol.declaration.filePath,
        line: symbol.declaration.line,
        kind: symbol.kind,
        scope: symbol.scope
      }))
    ).toEqual([{ id: "file:src/styles.css", file: "src/styles.css", line: 4, kind: "file", scope: "top-level" }]);
  });

  it("places removal chunk symbols by top-level/local scope rules", () => {
    const filePatch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "@@ -2,1 +2,1 @@",
      "-old",
      "+new",
      "@@ -5,1 +5,1 @@",
      "-inside-local",
      "+inside-local-replacement",
      "@@ -9,0 +9,1 @@",
      "+added-near-end",
      "@@ -12,1 +12,0 @@",
      "-outside"
    ].join("\n");

    const changedFiles = [
      {
        path: "src/a.ts",
        status: "modified",
        changedRanges: [],
        content: Array.from({ length: 14 }, (_, index) => `line-${index + 1}`).join("\n"),
        patch: filePatch
      }
    ];

    const topLevel = makeSymbol({
      id: "top",
      declaration: { filePath: "src/a.ts", line: 1, column: 1 },
      selectionRange: { startLine: 1, endLine: 10 },
      scope: "top-level"
    });
    const local = makeSymbol({
      id: "local",
      declaration: { filePath: "src/a.ts", line: 5, column: 3 },
      selectionRange: { startLine: 5, endLine: 8 },
      scope: "local",
      topLevelSymbolId: "top"
    });

    const removalSymbols = reviewInternal.buildRemovalChunkSymbols(changedFiles, [topLevel, local]);

    expect(
      removalSymbols.map((symbol) => ({
        line: symbol.declaration.line,
        scope: symbol.scope,
        top: symbol.topLevelSymbolId,
        name: symbol.name
      }))
    ).toEqual([
      { line: 2, scope: "local", top: "top", name: "1 lines removed, 1 lines added" },
      { line: 9, scope: "local", top: "top", name: "1 lines added" },
      { line: 12, scope: "top-level", top: null, name: "1 lines removed" }
    ]);
  });

  it("clamps removal anchors and counts content lines correctly", () => {
    expect(reviewInternal.countContentLines("")).toBe(0);
    expect(reviewInternal.countContentLines("a\nb")).toBe(2);
    expect(reviewInternal.countContentLines("a\nb\n")).toBe(2);
    expect(reviewInternal.normalizeRemovalAnchorLine(0, "a\nb")).toBe(1);
    expect(reviewInternal.normalizeRemovalAnchorLine(10, "a\nb")).toBe(3);
    expect(reviewInternal.normalizeRemovalAnchorLine(4, null)).toBe(4);
  });

  it("sorts symbols by file, line, then column", () => {
    const items = [
      makeSymbol({
        id: "b",
        declaration: { filePath: "src/b.ts", line: 1, column: 1 }
      }),
      makeSymbol({
        id: "a2",
        declaration: { filePath: "src/a.ts", line: 2, column: 1 }
      }),
      makeSymbol({
        id: "a1b",
        declaration: { filePath: "src/a.ts", line: 1, column: 2 }
      }),
      makeSymbol({
        id: "a1a",
        declaration: { filePath: "src/a.ts", line: 1, column: 1 }
      })
    ];

    const sorted = [...items].sort(reviewInternal.compareSymbols);
    expect(sorted.map((item) => item.id)).toEqual(["a1a", "a1b", "a2", "b"]);
  });

  it("builds a cross-file dependency graph from all displayed usages", () => {
    const symbolA = makeSymbol({
      id: "symbol-a",
      name: "a",
      declaration: { filePath: "src/a.ts", line: 1, column: 1 }
    });
    const symbolB = makeSymbol({
      id: "symbol-b",
      name: "b",
      declaration: { filePath: "src/b.ts", line: 1, column: 1 }
    });

    const graph = reviewInternal.buildReviewDependencyGraph(
      {
        review: {
          repoRoot: "demo-repo",
          defaultBranch: "origin/main",
          baseSha: "abc123",
          headSha: "def456",
          mode: "branch-diff",
          generatedAt: "2026-03-24T00:00:00.000Z"
        },
        files: [
          { path: "src/a.ts", status: "modified", changedRanges: [], content: null, patch: null },
          { path: "src/b.ts", status: "modified", changedRanges: [], content: null, patch: null }
        ],
        symbols: [symbolA, symbolB]
      },
      (symbolId) => {
        if (symbolId === "symbol-a") {
          return {
            symbol: symbolA,
            usages: [
              {
                location: { filePath: "src/a.ts", line: 1, column: 1 },
                isDefinition: true,
                isInDiff: true,
                preview: "export function a() {}"
              },
              {
                location: { filePath: "src/b.ts", line: 4, column: 3 },
                isDefinition: false,
                isInDiff: true,
                preview: "a();"
              },
              {
                location: { filePath: "src/c.ts", line: 4, column: 3 },
                isDefinition: false,
                isInDiff: false,
                preview: "a();"
              }
            ]
          };
        }

        return {
          symbol: symbolB,
          usages: [
            {
              location: { filePath: "src/a.ts", line: 3, column: 3 },
              isDefinition: false,
              isInDiff: true,
              preview: "b();"
            },
            {
              location: { filePath: "src/a.ts", line: 4, column: 3 },
              isDefinition: false,
              isInDiff: true,
              preview: "b();"
            },
            {
              location: { filePath: "src/b.ts", line: 4, column: 3 },
              isDefinition: false,
              isInDiff: true,
              preview: "b();"
            }
          ]
        };
      }
    );

    expect(graph).toEqual({
      nodes: [
        { id: "src/a.ts", filePath: "src/a.ts", status: "modified" },
        { id: "src/b.ts", filePath: "src/b.ts", status: "modified" },
        { id: "src/c.ts", filePath: "src/c.ts", status: "unchanged" }
      ],
      edges: [
        { id: "src/a.ts->src/b.ts", sourceFilePath: "src/a.ts", targetFilePath: "src/b.ts" },
        { id: "src/b.ts->src/a.ts", sourceFilePath: "src/b.ts", targetFilePath: "src/a.ts" },
        { id: "src/c.ts->src/a.ts", sourceFilePath: "src/c.ts", targetFilePath: "src/a.ts" }
      ]
    });
  });

  it("builds a static review bundle when every symbol has usages data", () => {
    const one = makeSymbol({ id: "one", name: "one" });
    const two = makeSymbol({ id: "two", name: "two" });
    const session = {
      bootstrap: {
        review: {
          repoRoot: "demo-repo",
          defaultBranch: "origin/main",
          baseSha: "abc123",
          headSha: "def456",
          mode: "branch-diff",
          generatedAt: "2026-03-24T00:00:00.000Z"
        },
        files: [],
        symbols: [one, two]
      },
      getFileContent(filePath: string) {
        if (filePath === "src/a.ts") {
          return {
            filePath,
            content: "one();\n"
          };
        }

        return null;
      },
      getUsages(symbolId: string) {
        if (symbolId === "one") {
          return {
            symbol: one,
            usages: [
              {
                location: {
                  filePath: "src/a.ts",
                  line: 4,
                  column: 2
                },
                isDefinition: false,
                isInDiff: true,
                preview: "one();"
              }
            ]
          };
        }

        return {
          symbol: two,
          usages: []
        };
      },
      getDependencyGraph() {
        return {
          nodes: [],
          edges: []
        };
      }
    };

    const bundle = reviewInternal.buildStaticReviewBundle(session);

    expect(bundle).toEqual({
      bootstrap: session.bootstrap,
      fileContentsByPath: {},
      usagesBySymbolId: {
        one: {
          symbol: one,
          usages: [
            {
              location: {
                filePath: "src/a.ts",
                line: 4,
                column: 2
              },
              isDefinition: false,
              isInDiff: true,
              preview: "one();"
            }
          ]
        },
        two: {
          symbol: two,
          usages: []
        }
      },
      dependencyGraph: {
        nodes: [],
        edges: []
      }
    });
  });

  it("throws when static bundle generation is missing usages for a symbol", () => {
    const one = makeSymbol({ id: "one", name: "one" });
    const session = {
      bootstrap: {
        review: {
          repoRoot: "demo-repo",
          defaultBranch: "origin/main",
          baseSha: "abc123",
          headSha: "def456",
          mode: "branch-diff",
          generatedAt: "2026-03-24T00:00:00.000Z"
        },
        files: [],
        symbols: [one]
      },
      getFileContent() {
        return null;
      },
      getUsages() {
        return null;
      }
    };

    expect(() => reviewInternal.buildStaticReviewBundle(session)).toThrow(
      "Missing usages for symbol in static review bundle: one"
    );
  });
});

function createTempRepo(): { repoRoot: string; cleanup: () => void } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-review-"));
  git(repoRoot, ["init"]);
  git(repoRoot, ["config", "user.name", "Argus Test"]);
  git(repoRoot, ["config", "user.email", "argus@example.com"]);
  git(repoRoot, ["checkout", "-b", "main"]);

  return {
    repoRoot,
    cleanup: () => {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  };
}

function writeRepoFile(repoRoot: string, filePath: string, content: string): void {
  const absolutePath = path.join(repoRoot, filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trimEnd();
}
