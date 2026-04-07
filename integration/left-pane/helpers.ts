import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ChangeStatus, ChangedFile, SymbolSummary } from "../../protocol";
import { createTypeScriptAnalyzer } from "../../language/typescript.ts";
import {
  compareSymbols as compareUiSymbols,
  filterLocalSymbolsForTopLevel,
  getChangeKindForFile,
  getChangeKindForSymbolPure,
  groupFilesByFolder,
  parseUnifiedPatch
} from "../../web-client/logic.js";
import { __internal as gitInternal } from "../../review/git.ts";
import { __internal as reviewInternal } from "../../review/index.ts";

type AnnotatedPrefix = "o" | "+" | "-";

interface AnnotatedRow {
  prefix: AnnotatedPrefix;
  text: string;
}

interface PatchRun {
  oldStartLine: number;
  newStartLine: number;
  rows: AnnotatedRow[];
}

export interface AnnotatedFileInput {
  path: string;
  status: ChangeStatus;
  annotated: string;
  trailingNewline?: boolean;
}

export function runLeftPaneScenario(files: readonly AnnotatedFileInput[]): string {
  const changedFiles = files.map((file) =>
    buildChangedFileFromAnnotated(file.path, file.status, file.annotated, {
      trailingNewline: file.trailingNewline
    })
  );
  const { repoRoot, cleanup } = createTempRepoWithFiles(changedFiles);

  try {
    const analyzerSymbols = findAnalyzerSymbols(repoRoot, changedFiles);
    const symbols = synthesizeSymbols(changedFiles, analyzerSymbols);
    return renderLeftPaneChoiceTree(changedFiles, symbols);
  } finally {
    cleanup();
  }
}

function parseAnnotatedRows(annotated: string): AnnotatedRow[] {
  const source = annotated.trim();
  if (source.length === 0) {
    return [];
  }

  const rows: AnnotatedRow[] = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const match = line.match(/^([o+-])(?: (.*))?$/);
    if (!match) {
      throw new Error(`Invalid annotated line ${index + 1}: "${line}"`);
    }

    rows.push({
      prefix: match[1] as AnnotatedPrefix,
      text: match[2] ?? ""
    });
  }

  return rows;
}

function buildChangedFileFromAnnotated(
  filePath: string,
  status: ChangeStatus,
  annotated: string,
  options: { trailingNewline?: boolean } = {}
): ChangedFile {
  const rows = parseAnnotatedRows(annotated);
  const runs: PatchRun[] = [];
  let activeRun: PatchRun | null = null;
  let oldLine = 1;
  let newLine = 1;
  const currentContentLines: string[] = [];

  const flushRun = () => {
    if (!activeRun || activeRun.rows.length === 0) {
      activeRun = null;
      return;
    }
    runs.push(activeRun);
    activeRun = null;
  };

  for (const row of rows) {
    if (row.prefix === "o") {
      flushRun();
      currentContentLines.push(row.text);
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if (!activeRun) {
      activeRun = {
        oldStartLine: oldLine,
        newStartLine: newLine,
        rows: []
      };
    }
    activeRun.rows.push(row);

    if (row.prefix === "-") {
      oldLine += 1;
      continue;
    }

    currentContentLines.push(row.text);
    newLine += 1;
  }

  flushRun();
  const normalizedPath = filePath.replaceAll("\\", "/");
  const patchLines = [`diff --git a/${normalizedPath} b/${normalizedPath}`];

  for (const run of runs) {
    const oldCount = run.rows.filter((row) => row.prefix === "-").length;
    const newCount = run.rows.filter((row) => row.prefix === "+").length;
    patchLines.push(`@@ -${run.oldStartLine},${oldCount} +${run.newStartLine},${newCount} @@`);
    for (const row of run.rows) {
      patchLines.push(`${row.prefix}${row.text}`);
    }
  }

  let content = currentContentLines.join("\n");
  if (options.trailingNewline === true && content.length > 0) {
    content += "\n";
  }

  const patch = patchLines.length > 1 ? patchLines.join("\n") : null;
  const contentOrNull = status === "deleted" ? null : content;

  return {
    path: filePath,
    status,
    changedRanges: gitInternal.parseChangedLineRanges(patch),
    content: contentOrNull,
    patch
  };
}

function createTempRepoWithFiles(files: readonly ChangedFile[]): { repoRoot: string; cleanup: () => void } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-left-pane-"));
  execFileSync("git", ["init"], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });

  for (const file of files) {
    if (file.content === null) {
      continue;
    }

    const absolutePath = path.resolve(repoRoot, file.path);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, file.content, "utf8");
  }

  execFileSync("git", ["add", "."], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });

  return {
    repoRoot,
    cleanup: () => {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  };
}

function findAnalyzerSymbols(repoRoot: string, files: readonly ChangedFile[]): SymbolSummary[] {
  const changedRangesByFile = new Map(files.map((file) => [file.path, file.changedRanges]));
  const analyzer = createTypeScriptAnalyzer({
    repoRoot,
    changedRangesByFile,
    changedFiles: files.map((file) => file.path)
  });
  return analyzer?.findTouchedSymbols() ?? [];
}

function synthesizeSymbols(changedFiles: readonly ChangedFile[], analyzerSymbols: readonly SymbolSummary[]): SymbolSummary[] {
  const fallbackSymbols = reviewInternal.buildUnsupportedFileSymbols(changedFiles, analyzerSymbols);
  const removalSymbols = reviewInternal.buildRemovalChunkSymbols(changedFiles, analyzerSymbols);
  return [...analyzerSymbols, ...fallbackSymbols, ...removalSymbols].sort(reviewInternal.compareSymbols);
}

function symbolLabel(symbol: SymbolSummary): string {
  if (symbol.kind === "unknown") {
    return `L${symbol.declaration.line} ${symbol.name}`;
  }
  return `L${symbol.declaration.line} ${symbol.kind} ${symbol.name}`;
}

function renderLeftPaneChoiceTree(changedFiles: readonly ChangedFile[], symbols: readonly SymbolSummary[]): string {
  const filesSorted = [...changedFiles].sort((left, right) => left.path.localeCompare(right.path));
  const patchRowsByPath = new Map(filesSorted.map((file) => [file.path, parseUnifiedPatch(file.patch)]));
  const lines: string[] = [];

  for (const folderGroup of groupFilesByFolder(filesSorted)) {
    lines.push(`folder ${folderGroup.folder}`);

    for (const file of folderGroup.files) {
      lines.push(`  file [${getChangeKindForFile(file)}] ${file.path}`);
      const patchRows = patchRowsByPath.get(file.path) ?? [];

      const topLevelSymbols = symbols
        .filter((symbol) => symbol.declaration.filePath === file.path)
        .filter((symbol) => symbol.kind !== "file")
        .filter((symbol) => symbol.scope === "top-level")
        .sort(compareUiSymbols);

      for (const topLevelSymbol of topLevelSymbols) {
        const topLevelKind = getChangeKindForSymbolPure(topLevelSymbol, file, patchRows);
        const localSymbols = filterLocalSymbolsForTopLevel(
          symbols
            .filter((symbol) => symbol.declaration.filePath === file.path)
            .filter((symbol) => symbol.kind !== "file")
            .filter((symbol) => symbol.scope === "local")
            .filter((symbol) => symbol.topLevelSymbolId === topLevelSymbol.id)
            .sort(compareUiSymbols),
          topLevelSymbol,
          file,
          patchRows
        );

        lines.push(`    top [${topLevelKind}] ${symbolLabel(topLevelSymbol)}`);

        for (const localSymbol of localSymbols) {
          const localKind = getChangeKindForSymbolPure(localSymbol, file, patchRows);
          lines.push(`      local [${localKind}] ${symbolLabel(localSymbol)}`);
        }
      }
    }
  }

  return lines.join("\n");
}
