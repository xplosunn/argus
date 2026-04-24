import path from "node:path";

import type {
  BootstrapResponse,
  ChangedFile,
  FileContentResponse,
  ReviewDependencyGraph,
  ReviewDependencyGraphNode,
  StaticReviewBundle,
  SymbolSummary,
  UsagesResponse
} from "../protocol";
import { createTypeScriptAnalyzer, isTypeScriptSupportedFile } from "../language/typescript";
import {
  areEquivalentBranchRefs,
  detectDefaultBranch,
  getChangedFiles,
  getChangedLineRanges,
  getChangedLineRangesAgainstHead,
  getCurrentBranch,
  getFileContentAtHead,
  getFileContentInWorkingTree,
  getFilePatch,
  getFilePatchAgainstHead,
  getHeadSha,
  getMergeBase,
  getUncommittedChangedFiles
} from "./git";

export interface CreateReviewSessionOptions {
  repoRoot: string;
  defaultBranch?: string;
}

export interface ReviewSession {
  bootstrap: BootstrapResponse;
  getFileContent(filePath: string): FileContentResponse | null;
  getUsages(symbolId: string): UsagesResponse | null;
  getDependencyGraph(): ReviewDependencyGraph;
}

export function createStaticReviewBundle(options: CreateReviewSessionOptions): StaticReviewBundle {
  return buildStaticReviewBundle(createReviewSession(options));
}

export function createReviewSession(options: CreateReviewSessionOptions): ReviewSession {
  const defaultBranch = options.defaultBranch ?? detectDefaultBranch(options.repoRoot);
  const currentBranch = getCurrentBranch(options.repoRoot);
  const isOnDefaultBranch = areEquivalentBranchRefs(currentBranch, defaultBranch);
  if (!isOnDefaultBranch) {
    assertBranchReviewHasCleanWorktree(options.repoRoot, defaultBranch, currentBranch);
  }
  const headSha = getHeadSha(options.repoRoot);
  const baseSha = isOnDefaultBranch ? headSha : getMergeBase(options.repoRoot, defaultBranch);

  const changedFiles: ChangedFile[] = isOnDefaultBranch
    ? getUncommittedChangedFiles(options.repoRoot).map((meta) => {
        const changedRanges = getChangedLineRangesAgainstHead(options.repoRoot, meta.path, meta.status);
        const content = meta.status === "deleted" ? null : getFileContentInWorkingTree(options.repoRoot, meta.path);
        const patch = getFilePatchAgainstHead(options.repoRoot, meta.path, meta.status);

        return {
          path: meta.path,
          status: meta.status,
          changedRanges,
          content,
          patch
        };
      })
    : getChangedFiles(options.repoRoot, baseSha).map((meta) => {
        const changedRanges = getChangedLineRanges(options.repoRoot, baseSha, meta.path);
        const content = meta.status === "deleted" ? null : getFileContentAtHead(options.repoRoot, meta.path);
        const patch = getFilePatch(options.repoRoot, baseSha, meta.path);

        return {
          path: meta.path,
          status: meta.status,
          changedRanges,
          content,
          patch
        };
      });
  const fileContentByPath = new Map(changedFiles.map((file) => [file.path, file.content]));

  const changedRangesByFile = new Map(changedFiles.map((file) => [file.path, file.changedRanges]));
  const analyzer = createTypeScriptAnalyzer({
    repoRoot: options.repoRoot,
    changedRangesByFile,
    changedFiles: changedFiles.map((file) => file.path)
  });
  const analyzerSymbols = analyzer?.findTouchedSymbols() ?? [];
  const fallbackSymbols = buildUnsupportedFileSymbols(changedFiles, analyzerSymbols);
  const removalSymbols = buildRemovalChunkSymbols(changedFiles, analyzerSymbols);
  const symbols = [...analyzerSymbols, ...fallbackSymbols, ...removalSymbols].sort(compareSymbols);
  const fallbackSymbolMap = new Map([...fallbackSymbols, ...removalSymbols].map((symbol) => [symbol.id, symbol]));

  const bootstrap: BootstrapResponse = {
    review: {
      repoRoot: options.repoRoot,
      defaultBranch,
      baseSha,
      headSha,
      mode: isOnDefaultBranch ? "working-tree" : "branch-diff",
      generatedAt: new Date().toISOString()
    },
    files: changedFiles.map((file) => ({
      path: file.path,
      status: file.status,
      changedRanges: file.changedRanges,
      content: null,
      patch: file.patch
    })),
    symbols
  };
  let dependencyGraph: ReviewDependencyGraph | null = null;
  const getUsagesForSymbol = (symbolId: string): UsagesResponse | null => {
    const analyzerResult = analyzer?.getUsages(symbolId);
    if (analyzerResult) {
      return analyzerResult;
    }

    const fallbackSymbol = fallbackSymbolMap.get(symbolId);
    if (!fallbackSymbol) {
      return null;
    }

    return {
      symbol: fallbackSymbol,
      usages: []
    };
  };

  return {
    bootstrap,
    getFileContent(filePath: string): FileContentResponse | null {
      if (!fileContentByPath.has(filePath)) {
        return null;
      }

      return {
        filePath,
        content: fileContentByPath.get(filePath) ?? null
      };
    },
    getUsages: getUsagesForSymbol,
    getDependencyGraph(): ReviewDependencyGraph {
      dependencyGraph ??= buildReviewDependencyGraph(bootstrap, getUsagesForSymbol);
      return dependencyGraph;
    }
  };
}

function assertBranchReviewHasCleanWorktree(repoRoot: string, defaultBranch: string, currentBranch: string): void {
  if (getUncommittedChangedFiles(repoRoot).length === 0) {
    return;
  }

  throw new Error(
    `Argus won't review ${defaultBranch}...HEAD while uncommitted changes are present on ${currentBranch}. Commit or stash them first, or rerun with --default-branch ${currentBranch} to review the uncommitted changes on your current branch instead.`
  );
}

function buildUnsupportedFileSymbols(
  changedFiles: readonly ChangedFile[],
  existingSymbols: readonly SymbolSummary[]
): SymbolSummary[] {
  const filesWithSymbols = new Set(existingSymbols.map((symbol) => symbol.declaration.filePath));
  const fallbackSymbols: SymbolSummary[] = [];

  for (const changedFile of changedFiles) {
    if (isTypeScriptSupportedFile(changedFile.path)) {
      continue;
    }
    if (filesWithSymbols.has(changedFile.path)) {
      continue;
    }

    const firstChangedLine = changedFile.changedRanges[0]?.startLine ?? 1;
    fallbackSymbols.push({
      id: `file:${changedFile.path}`,
      name: path.basename(changedFile.path),
      kind: "file",
      declaration: {
        filePath: changedFile.path,
        line: firstChangedLine,
        column: 1
      },
      selectionRange: {
        startLine: firstChangedLine,
        endLine: firstChangedLine
      },
      isDeclarationInDiff: true,
      scope: "top-level",
      topLevelSymbolId: null
    });
  }

  return fallbackSymbols;
}

export interface RemovedChunk {
  anchorLine: number;
  removedLineCount: number;
  addedLineCount: number;
}

function buildRemovalChunkSymbols(
  changedFiles: readonly ChangedFile[],
  existingSymbols: readonly SymbolSummary[]
): SymbolSummary[] {
  const topLevelSymbolsByFile = new Map<string, SymbolSummary[]>();
  const localSymbolsByTopLevelId = new Map<string, SymbolSummary[]>();

  for (const symbol of existingSymbols) {
    if (symbol.kind === "file" || symbol.kind === "unknown") {
      continue;
    }

    if (symbol.scope === "top-level") {
      const fileSymbols = topLevelSymbolsByFile.get(symbol.declaration.filePath) ?? [];
      fileSymbols.push(symbol);
      topLevelSymbolsByFile.set(symbol.declaration.filePath, fileSymbols);
      continue;
    }

    const parentId = symbol.topLevelSymbolId;
    if (!parentId) {
      continue;
    }

    const localSymbols = localSymbolsByTopLevelId.get(parentId) ?? [];
    localSymbols.push(symbol);
    localSymbolsByTopLevelId.set(parentId, localSymbols);
  }

  const removalSymbols: SymbolSummary[] = [];

  for (const changedFile of changedFiles) {
    const removedChunks = parseRemovedChunks(changedFile.patch);
    if (removedChunks.length === 0) {
      continue;
    }

    const topLevelSymbolsInFile = topLevelSymbolsByFile.get(changedFile.path) ?? [];
    let chunkIndex = 0;
    for (const chunk of removedChunks) {
      const anchorLine = normalizeRemovalAnchorLine(chunk.anchorLine, changedFile.content);
      const followedByAdded = chunk.addedLineCount > 0;
      const parentTopLevelSymbol = findContainingSymbol(topLevelSymbolsInFile, anchorLine, followedByAdded);
      if (parentTopLevelSymbol) {
        const localSymbols = localSymbolsByTopLevelId.get(parentTopLevelSymbol.id) ?? [];
        if (isRemovalChunkCoveredBySymbol(localSymbols, anchorLine, followedByAdded)) {
          continue;
        }

        removalSymbols.push({
          id: `removed:${changedFile.path}:${anchorLine}:${chunkIndex}`,
          name: formatRemovedChunkName(chunk),
          kind: "unknown",
          declaration: {
            filePath: changedFile.path,
            line: anchorLine,
            column: 0
          },
          selectionRange: {
            startLine: anchorLine,
            endLine: anchorLine
          },
          isDeclarationInDiff: true,
          scope: "local",
          topLevelSymbolId: parentTopLevelSymbol.id
        });
        chunkIndex += 1;
        continue;
      }

      removalSymbols.push({
        id: `removed:${changedFile.path}:${anchorLine}:${chunkIndex}`,
        name: formatRemovedChunkName(chunk),
        kind: "unknown",
        declaration: {
          filePath: changedFile.path,
          line: anchorLine,
          column: 0
        },
        selectionRange: {
          startLine: anchorLine,
          endLine: anchorLine
        },
        isDeclarationInDiff: true,
        scope: "top-level",
        topLevelSymbolId: null
      });
      chunkIndex += 1;
    }
  }

  return removalSymbols;
}

function formatRemovedChunkName(chunk: RemovedChunk): string {
  const parts: string[] = [];
  if (chunk.removedLineCount > 0) {
    parts.push(`${chunk.removedLineCount} lines removed`);
  }
  if (chunk.addedLineCount > 0) {
    parts.push(`${chunk.addedLineCount} lines added`);
  }
  if (parts.length === 0) {
    return "0 lines removed, 0 lines added";
  }
  return parts.join(", ");
}

function isRemovalChunkCoveredBySymbol(
  symbolsInFile: readonly SymbolSummary[],
  anchorLine: number,
  followedByAdded: boolean
): boolean {
  return findContainingSymbol(symbolsInFile, anchorLine, followedByAdded) !== null;
}

function findContainingSymbol(
  symbols: readonly SymbolSummary[],
  anchorLine: number,
  followedByAdded: boolean
): SymbolSummary | null {
  for (const symbol of symbols) {
    const startLine = symbol.selectionRange.startLine;
    const endLine = symbol.selectionRange.endLine;

    if (anchorLine > startLine && anchorLine <= endLine) {
      return symbol;
    }

    if (anchorLine === startLine && followedByAdded) {
      return symbol;
    }
  }

  return null;
}

function parseRemovedChunks(patchText: string | null): RemovedChunk[] {
  if (patchText === null || patchText.trim() === "") {
    return [];
  }

  const removedChunks: RemovedChunk[] = [];
  const lines = patchText.split(/\r?\n/);
  const hunkHeaderRegex = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
  let inHunk = false;
  let newLine = 0;
  let currentChunk: RemovedChunk | null = null;

  for (const line of lines) {
    const hunkMatch = line.match(hunkHeaderRegex);
    if (hunkMatch) {
      if (currentChunk && (currentChunk.removedLineCount > 0 || currentChunk.addedLineCount > 0)) {
        removedChunks.push(currentChunk);
      }
      currentChunk = null;
      inHunk = true;
      newLine = Number.parseInt(hunkMatch[1] ?? "0", 10);
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (isRemovedDiffLine(line)) {
      if (currentChunk && currentChunk.removedLineCount === 0 && currentChunk.addedLineCount > 0) {
        removedChunks.push(currentChunk);
        currentChunk = null;
      }

      if (!currentChunk) {
        currentChunk = {
          anchorLine: newLine,
          removedLineCount: 0,
          addedLineCount: 0
        };
      }

      currentChunk.removedLineCount += 1;
      continue;
    }

    if (isAddedDiffLine(line)) {
      if (!currentChunk) {
        currentChunk = {
          anchorLine: newLine,
          removedLineCount: 0,
          addedLineCount: 0
        };
      }

      currentChunk.addedLineCount += 1;
      newLine += 1;
      continue;
    }

    if (currentChunk && (currentChunk.removedLineCount > 0 || currentChunk.addedLineCount > 0)) {
      removedChunks.push(currentChunk);
    }
    currentChunk = null;

    if (isContextDiffLine(line)) {
      newLine += 1;
      continue;
    }
  }

  if (currentChunk && (currentChunk.removedLineCount > 0 || currentChunk.addedLineCount > 0)) {
    removedChunks.push(currentChunk);
  }
  return removedChunks;
}

function isAddedDiffLine(line: string): boolean {
  return line.startsWith("+") && !line.startsWith("+++");
}

function isRemovedDiffLine(line: string): boolean {
  return line.startsWith("-") && !line.startsWith("---");
}

function isContextDiffLine(line: string): boolean {
  return line.startsWith(" ");
}

function normalizeRemovalAnchorLine(anchorLine: number, fileContent: string | null): number {
  const clampedAnchor = Math.max(1, anchorLine);
  if (fileContent === null) {
    return clampedAnchor;
  }

  const lineCount = countContentLines(fileContent);
  if (lineCount === 0) {
    return 1;
  }

  return Math.min(clampedAnchor, lineCount + 1);
}

function countContentLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  const lines = content.split(/\r?\n/);
  if (content.endsWith("\n") || content.endsWith("\r\n")) {
    return lines.length - 1;
  }
  return lines.length;
}

function compareSymbols(left: SymbolSummary, right: SymbolSummary): number {
  if (left.declaration.filePath !== right.declaration.filePath) {
    return left.declaration.filePath.localeCompare(right.declaration.filePath);
  }
  if (left.declaration.line !== right.declaration.line) {
    return left.declaration.line - right.declaration.line;
  }
  return left.declaration.column - right.declaration.column;
}

function buildReviewDependencyGraph(
  bootstrap: BootstrapResponse,
  getUsages: (symbolId: string) => UsagesResponse | null
): ReviewDependencyGraph {
  const fileByPath = new Map(bootstrap.files.map((file) => [file.path, file]));
  const graphFilePaths = new Set(bootstrap.files.map((file) => file.path));

  const edgeKeys = new Set<string>();

  for (const symbol of bootstrap.symbols) {
    if (symbol.kind === "file") {
      continue;
    }

    const targetFilePath = symbol.declaration.filePath;
    if (!fileByPath.has(targetFilePath)) {
      continue;
    }

    const usages = getUsages(symbol.id);
    if (!usages) {
      continue;
    }

    for (const usage of usages.usages) {
      const sourceFilePath = usage.location.filePath;
      if (!sourceFilePath || sourceFilePath === targetFilePath) {
        continue;
      }

      graphFilePaths.add(sourceFilePath);
      const key = `${sourceFilePath}\0${targetFilePath}`;
      edgeKeys.add(key);
    }
  }

  const nodes: ReviewDependencyGraphNode[] = [...graphFilePaths]
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => {
      const file = fileByPath.get(filePath);
      return {
        id: filePath,
        filePath,
        status: file ? file.status : "unchanged"
      };
    });

  const edges = [...edgeKeys]
    .map((key) => {
      const [sourceFilePath, targetFilePath] = key.split("\0");
      return {
        id: `${sourceFilePath}->${targetFilePath}`,
        sourceFilePath,
        targetFilePath
      };
    })
    .sort((left, right) => {
      if (left.sourceFilePath !== right.sourceFilePath) {
        return left.sourceFilePath.localeCompare(right.sourceFilePath);
      }
      return left.targetFilePath.localeCompare(right.targetFilePath);
    });

  return {
    nodes,
    edges
  };
}

function buildStaticReviewBundle(session: ReviewSession): StaticReviewBundle {
  const fileContentsByPath: Record<string, string | null> = {};
  const usagesBySymbolId: Record<string, UsagesResponse> = {};

  for (const file of session.bootstrap.files) {
    const fileContent = session.getFileContent(file.path);
    if (!fileContent) {
      throw new Error(`Missing file content for static review bundle: ${file.path}`);
    }

    fileContentsByPath[file.path] = fileContent.content;
  }

  for (const symbol of session.bootstrap.symbols) {
    const usages = session.getUsages(symbol.id);
    if (!usages) {
      throw new Error(`Missing usages for symbol in static review bundle: ${symbol.id}`);
    }

    usagesBySymbolId[symbol.id] = usages;
  }

  return {
    bootstrap: session.bootstrap,
    fileContentsByPath,
    usagesBySymbolId,
    dependencyGraph: buildReviewDependencyGraph(session.bootstrap, (symbolId) => usagesBySymbolId[symbolId] ?? null)
  };
}

export const __internal = {
  assertBranchReviewHasCleanWorktree,
  buildUnsupportedFileSymbols,
  buildRemovalChunkSymbols,
  buildStaticReviewBundle,
  formatRemovedChunkName,
  isRemovalChunkCoveredBySymbol,
  findContainingSymbol,
  parseRemovedChunks,
  normalizeRemovalAnchorLine,
  countContentLines,
  compareSymbols,
  buildReviewDependencyGraph
};
