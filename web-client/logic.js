export const SHIKI_LANGS_FALLBACK = ["ts", "tsx", "js", "jsx", "json", "css", "html", "md", "bash", "yaml"];

export function normalizeTargetSelection(target) {
  if (target === null || target === undefined) {
    return null;
  }

  if (typeof target === "number" && Number.isFinite(target)) {
    const line = Math.max(1, Math.trunc(target));
    return {
      startLine: line,
      endLine: line,
      focusLine: line
    };
  }

  if (typeof target !== "object") {
    return null;
  }

  const rawStart = Number(target.startLine);
  const rawEnd = Number(target.endLine);
  const rawFocus = Number(target.focusLine);
  const includeRemovedRows = target.includeRemovedRows === true;
  const includeCurrentRows = target.includeCurrentRows !== false;
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
    return null;
  }

  const startLine = Math.max(1, Math.trunc(rawStart));
  const endLine = Math.max(startLine, Math.trunc(rawEnd));
  let focusLine = Number.isFinite(rawFocus) ? Math.trunc(rawFocus) : startLine;
  if (focusLine < startLine || focusLine > endLine) {
    focusLine = startLine;
  }

  return {
    startLine,
    endLine,
    focusLine,
    includeRemovedRows,
    includeCurrentRows
  };
}

export function getTargetSelectionForSymbol(symbol) {
  if (!symbol || typeof symbol !== "object") {
    return null;
  }

  const rawDeclarationLine = Number(symbol.declaration?.line);
  if (!Number.isFinite(rawDeclarationLine)) {
    return null;
  }

  const declarationLine = Math.max(1, Math.trunc(rawDeclarationLine));
  const rawStartLine = Number(symbol.selectionRange?.startLine);
  const rawEndLine = Number(symbol.selectionRange?.endLine);
  const startLine = Number.isFinite(rawStartLine) ? Math.max(1, Math.trunc(rawStartLine)) : declarationLine;
  const selectionEndLine = Number.isFinite(rawEndLine) ? Math.max(startLine, Math.trunc(rawEndLine)) : declarationLine;
  const removedEntryCounts =
    typeof symbol.id === "string" && symbol.id.startsWith("removed:") ? parseRemovedEntryCounts(symbol.name) : null;
  const endLine =
    removedEntryCounts && removedEntryCounts.added > 0 ? startLine + removedEntryCounts.added - 1 : selectionEndLine;

  return normalizeTargetSelection({
    startLine,
    endLine,
    focusLine: declarationLine,
    // Regular symbol selections should keep removed rows inside the same highlighted block.
    includeRemovedRows: removedEntryCounts ? removedEntryCounts.removed > 0 : true,
    includeCurrentRows: removedEntryCounts ? removedEntryCounts.added > 0 : true
  });
}

export function isLineInTargetSelection(lineNumber, targetSelection) {
  if (!targetSelection) {
    return false;
  }

  return lineNumber >= targetSelection.startLine && lineNumber <= targetSelection.endLine;
}

export function getBundledLanguageIds(shikiModule) {
  const bundled = shikiModule?.bundledLanguages;
  if (Array.isArray(bundled)) {
    return bundled
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (entry && typeof entry === "object") {
          if (typeof entry.id === "string") {
            return entry.id;
          }
          if (typeof entry.name === "string") {
            return entry.name;
          }
        }
        return null;
      })
      .filter((value) => typeof value === "string");
  }

  if (bundled && typeof bundled === "object") {
    return Object.keys(bundled);
  }

  return [];
}

export function resolveShikiLanguageIdsForCurrentDiff(
  bundledLanguageIds,
  diffLanguageCandidates,
  fallbackLanguages = SHIKI_LANGS_FALLBACK
) {
  if (!Array.isArray(bundledLanguageIds) || bundledLanguageIds.length === 0) {
    return fallbackLanguages;
  }

  const bundledSet = new Set(bundledLanguageIds);
  const requestedForDiff = diffLanguageCandidates.filter((languageId) => bundledSet.has(languageId));
  if (requestedForDiff.length > 0) {
    return requestedForDiff;
  }

  const fallbackSupported = fallbackLanguages.filter((languageId) => bundledSet.has(languageId));
  if (fallbackSupported.length > 0) {
    return fallbackSupported;
  }

  return bundledLanguageIds;
}

export function getShikiLanguageCandidates(filePath) {
  const lowerPath = filePath.toLowerCase();
  const fileName = lowerPath.split("/").pop() ?? lowerPath;
  const candidates = [];
  const seen = new Set();

  const add = (value) => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    candidates.push(value);
  };

  const aliasByExtension = {
    cts: "ts",
    mts: "ts",
    cjs: "js",
    mjs: "js",
    htm: "html",
    yml: "yaml",
    markdown: "md"
  };

  if (fileName.startsWith(".") && fileName.length > 1) {
    add(fileName.slice(1));
  }

  const parts = fileName.split(".");
  if (parts.length > 1) {
    for (let index = 1; index < parts.length; index += 1) {
      const extension = parts.slice(index).join(".");
      add(extension);
      add(aliasByExtension[extension] ?? null);
    }
  } else {
    add(fileName);
  }

  if (fileName === "dockerfile") {
    add("dockerfile");
    add("docker");
  }

  if (fileName === "makefile") {
    add("make");
  }

  return candidates;
}

export function parseUnifiedPatch(patchText) {
  if (!patchText) {
    return [];
  }

  const rows = [];
  const lines = patchText.split(/\r?\n/);
  const hunkHeaderRegex = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    const hunkMatch = line.match(hunkHeaderRegex);
    if (hunkMatch) {
      inHunk = true;
      oldLine = Number.parseInt(hunkMatch[1], 10);
      newLine = Number.parseInt(hunkMatch[2], 10);
      rows.push({
        type: "hunk",
        oldLine: null,
        newLine: null,
        anchorNewLine: null,
        text: line
      });
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      rows.push({
        type: "added",
        oldLine: null,
        newLine,
        anchorNewLine: null,
        text: line.slice(1)
      });
      newLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      rows.push({
        type: "removed",
        oldLine,
        newLine: null,
        anchorNewLine: newLine,
        text: line.slice(1)
      });
      oldLine += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      rows.push({
        type: "context",
        oldLine,
        newLine,
        anchorNewLine: null,
        text: line.slice(1)
      });
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if (line.startsWith("\\ No newline at end of file")) {
      rows.push({
        type: "meta",
        oldLine: null,
        newLine: null,
        anchorNewLine: null,
        text: line
      });
    }
  }

  return rows;
}

export function countPatchLineTotals(patchText) {
  let added = 0;
  let removed = 0;

  for (const row of parseUnifiedPatch(patchText)) {
    if (row.type === "added") {
      added += 1;
      continue;
    }

    if (row.type === "removed") {
      removed += 1;
    }
  }

  return {
    added,
    removed
  };
}

export function markerForRowType(rowType) {
  if (rowType === "added") {
    return "+";
  }
  if (rowType === "removed") {
    return "-";
  }
  if (rowType === "hunk") {
    return "@";
  }
  if (rowType === "meta") {
    return "!";
  }
  return " ";
}

export function formatLineNumber(lineNumber) {
  if (lineNumber === null || lineNumber === undefined) {
    return "";
  }
  return String(lineNumber).padStart(4, " ");
}

export function getLineNumberColumnWidth(lineNumbers, minimumDigits = 1) {
  let maxDigits = Number.isFinite(minimumDigits) ? Math.max(1, Math.trunc(minimumDigits)) : 1;

  for (const lineNumber of lineNumbers ?? []) {
    const numericLineNumber = Number(lineNumber);
    if (!Number.isFinite(numericLineNumber)) {
      continue;
    }

    const normalizedLineNumber = Math.max(0, Math.trunc(Math.abs(numericLineNumber)));
    maxDigits = Math.max(maxDigits, String(normalizedLineNumber).length);
  }

  return maxDigits;
}

export function clampAnchorLine(anchorLine, maxLine) {
  if (anchorLine === null || anchorLine === undefined) {
    return maxLine + 1;
  }
  if (anchorLine < 1) {
    return 1;
  }
  if (anchorLine > maxLine + 1) {
    return maxLine + 1;
  }
  return anchorLine;
}

export function groupFilesByFolder(files) {
  const byFolder = new Map();
  for (const file of files) {
    const folder = folderForPath(file.path);
    const list = byFolder.get(folder) ?? [];
    list.push(file);
    byFolder.set(folder, list);
  }

  return [...byFolder.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([folder, folderFiles]) => ({
      folder,
      files: [...folderFiles]
    }));
}

export function folderForPath(filePath) {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) {
    return ".";
  }
  return filePath.slice(0, lastSlash);
}

export function fileNameForPath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return "";
  }

  const normalizedPath = filePath.endsWith("/") ? filePath.slice(0, -1) : filePath;
  const lastSlash = normalizedPath.lastIndexOf("/");
  if (lastSlash === -1) {
    return normalizedPath;
  }
  return normalizedPath.slice(lastSlash + 1);
}

export function getChangeKindForFile(file) {
  const status = String(file?.status ?? "modified");

  if (status === "added" || status === "copied") {
    return "added";
  }
  if (status === "deleted") {
    return "removed";
  }
  return "modified";
}

export function getChangeKindForSymbolPure(symbol, file, patchRows) {
  if (typeof symbol?.id === "string" && symbol.id.startsWith("removed:")) {
    const removedEntryCounts = parseRemovedEntryCounts(symbol.name);
    if (removedEntryCounts !== null) {
      if (removedEntryCounts.removed > 0 && removedEntryCounts.added > 0) {
        return "modified";
      }
      if (removedEntryCounts.removed > 0) {
        return "removed";
      }
      if (removedEntryCounts.added > 0) {
        return "added";
      }
    }
    return "removed";
  }

  if (!file) {
    return "modified";
  }

  const fileChangeKind = getChangeKindForFile(file);
  if (fileChangeKind === "added" || fileChangeKind === "removed") {
    return fileChangeKind;
  }

  const startLine = Number(symbol.selectionRange?.startLine ?? symbol.declaration?.line ?? 1);
  const endLine = Number(symbol.selectionRange?.endLine ?? symbol.declaration?.line ?? startLine);
  const normalizedStart = Math.max(1, Math.trunc(startLine));
  const normalizedEnd = Math.max(normalizedStart, Math.trunc(endLine));
  let hasAdded = false;
  let hasRemoved = false;

  for (const patchRow of patchRows ?? []) {
    if (patchRow.type === "added" && patchRow.newLine !== null) {
      if (patchRow.newLine >= normalizedStart && patchRow.newLine <= normalizedEnd) {
        hasAdded = true;
      }
      continue;
    }

    if (patchRow.type === "removed" && patchRow.anchorNewLine !== null) {
      if (patchRow.anchorNewLine >= normalizedStart && patchRow.anchorNewLine <= normalizedEnd + 1) {
        hasRemoved = true;
      }
    }
  }

  if (hasAdded && hasRemoved) {
    return "modified";
  }
  if (hasAdded) {
    if (!symbol.isDeclarationInDiff) {
      return "modified";
    }
    return "added";
  }
  if (hasRemoved) {
    return "modified";
  }
  if (symbol.isDeclarationInDiff) {
    return "modified";
  }
  return "modified";
}

export function isSyntheticLineCountSymbol(symbol) {
  return symbol?.kind === "unknown" && typeof symbol?.id === "string" && symbol.id.startsWith("removed:");
}

export function filterLocalSymbolsForTopLevel(localSymbols, topLevelSymbol, file, patchRows) {
  if (!Array.isArray(localSymbols)) {
    return [];
  }

  if (!topLevelSymbol) {
    return [...localSymbols];
  }

  const topLevelChangeKind = getChangeKindForSymbolPure(topLevelSymbol, file, patchRows);
  if (topLevelChangeKind !== "added") {
    return [...localSymbols];
  }

  return localSymbols.filter((symbol) => !isSyntheticLineCountSymbol(symbol));
}

export function normalizeChangeKind(changeKind) {
  if (changeKind === "added" || changeKind === "removed" || changeKind === "modified") {
    return changeKind;
  }
  return null;
}

export function parseRemovedEntryCounts(entryName) {
  if (typeof entryName !== "string") {
    return null;
  }

  const parts = entryName.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) {
    return null;
  }

  let removed = 0;
  let added = 0;
  let seenRemoved = false;
  let seenAdded = false;

  for (const part of parts) {
    const match = part.match(/^(\d+)\s+lines?\s+(removed|added)$/);
    if (!match) {
      return null;
    }

    const count = Number.parseInt(match[1], 10);
    if (!Number.isFinite(count)) {
      return null;
    }

    if (match[2] === "removed") {
      if (seenRemoved) {
        return null;
      }
      removed = count;
      seenRemoved = true;
      continue;
    }

    if (seenAdded) {
      return null;
    }
    added = count;
    seenAdded = true;
  }

  return {
    removed,
    added
  };
}

export function compareSymbols(left, right) {
  if (left.declaration.filePath !== right.declaration.filePath) {
    return left.declaration.filePath.localeCompare(right.declaration.filePath);
  }
  if (left.declaration.line !== right.declaration.line) {
    return left.declaration.line - right.declaration.line;
  }
  return left.declaration.column - right.declaration.column;
}

export function normalizeSortMode(mode) {
  return mode === "usages" ? "usages" : "alphabetical";
}

export function compareFilesForSortMode(leftPath, rightPath, sortMode, getUsageDiffCountForFile) {
  if (sortMode === "usages") {
    const leftUsageCount = getUsageDiffCountForFile(leftPath);
    const rightUsageCount = getUsageDiffCountForFile(rightPath);
    if (leftUsageCount !== rightUsageCount) {
      return leftUsageCount - rightUsageCount;
    }
  }

  return leftPath.localeCompare(rightPath);
}

export function countUsagesInDiff(usages) {
  return usages.filter((usage) => usage.isInDiff).length;
}

export function countReferences(usages) {
  return (Array.isArray(usages) ? usages : []).filter((usage) => usage?.isDefinition !== true).length;
}
