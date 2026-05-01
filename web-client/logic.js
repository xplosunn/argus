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

export function groupDirectoriesByDependencyRank(graph) {
  const directoriesByPath = new Map();

  for (const node of graph?.nodes ?? []) {
    if (typeof node?.filePath !== "string" || node.filePath.length === 0) {
      continue;
    }

    const directoryPath = folderForPath(node.filePath);
    const directory = directoriesByPath.get(directoryPath) ?? {
      path: directoryPath,
      nodes: []
    };
    directory.nodes.push(node);
    directoriesByPath.set(directoryPath, directory);
  }

  for (const directory of directoriesByPath.values()) {
    directory.nodes.sort((left, right) => left.filePath.localeCompare(right.filePath));
  }

  const dependencyPathsByDirectory = new Map(
    [...directoriesByPath.keys()].map((directoryPath) => [directoryPath, new Set()])
  );

  for (const edge of graph?.edges ?? []) {
    if (typeof edge?.sourceFilePath !== "string" || typeof edge?.targetFilePath !== "string") {
      continue;
    }

    const sourceDirectoryPath = folderForPath(edge.sourceFilePath);
    const targetDirectoryPath = folderForPath(edge.targetFilePath);
    if (
      sourceDirectoryPath === targetDirectoryPath ||
      !directoriesByPath.has(sourceDirectoryPath) ||
      !directoriesByPath.has(targetDirectoryPath)
    ) {
      continue;
    }

    dependencyPathsByDirectory.get(sourceDirectoryPath)?.add(targetDirectoryPath);
  }

  const remainingDirectoryPaths = new Set(directoriesByPath.keys());
  const columns = [];

  while (remainingDirectoryPaths.size > 0) {
    const nextRankPaths = [...remainingDirectoryPaths]
      .filter((directoryPath) => {
        const dependencyPaths = dependencyPathsByDirectory.get(directoryPath) ?? new Set();
        for (const dependencyPath of dependencyPaths) {
          if (remainingDirectoryPaths.has(dependencyPath)) {
            return false;
          }
        }
        return true;
      })
      .sort((left, right) => left.localeCompare(right));

    const columnPaths =
      nextRankPaths.length > 0
        ? nextRankPaths
        : [...remainingDirectoryPaths].sort((left, right) => left.localeCompare(right));

    columns.push(columnPaths.map((directoryPath) => directoriesByPath.get(directoryPath)));
    for (const directoryPath of columnPaths) {
      remainingDirectoryPaths.delete(directoryPath);
    }
  }

  return columns;
}

export function filterDependencyGraphEdgesForHiddenSources(edges, hiddenSourceDirectoryPaths) {
  const hiddenSet =
    hiddenSourceDirectoryPaths instanceof Set
      ? hiddenSourceDirectoryPaths
      : new Set(
          (Array.isArray(hiddenSourceDirectoryPaths) ? hiddenSourceDirectoryPaths : []).filter(
            (directoryPath) => typeof directoryPath === "string" && directoryPath.length > 0
          )
        );

  return (edges ?? []).filter((edge) => !hiddenSet.has(edge?.sourceDirectoryPath));
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

export function nextDependencyEdgeLaneMeta(source, sourceDirectory, target, targetDirectory, columnCount, laneState) {
  const sourceColumnIndex = Number(sourceDirectory?.columnIndex);
  const targetColumnIndex = Number(targetDirectory?.columnIndex);
  if (!Number.isInteger(sourceColumnIndex) || !Number.isInteger(targetColumnIndex)) {
    return null;
  }

  if (sourceColumnIndex === targetColumnIndex) {
    const side = chooseSameColumnDependencyEdgeSide(
      source,
      target,
      sourceColumnIndex,
      columnCount,
      laneState?.columnOuterLaneCountsByKey
    );
    const laneIndex = consumeDependencyLaneIndex(
      laneState?.columnOuterLaneCountsByKey,
      `${sourceColumnIndex}\0${side}`
    );
    return {
      route: "same-column",
      side,
      laneIndex
    };
  }

  const direction = targetColumnIndex > sourceColumnIndex ? "rightward" : "leftward";
  const startGutterIndex = direction === "rightward" ? sourceColumnIndex : sourceColumnIndex - 1;
  const endGutterIndex = direction === "rightward" ? targetColumnIndex - 1 : targetColumnIndex;
  if (startGutterIndex < 0 || endGutterIndex < 0 || startGutterIndex === endGutterIndex) {
    const laneIndex = consumeDependencyLaneIndex(
      laneState?.gutterLaneCountsByKey,
      `${Math.max(startGutterIndex, endGutterIndex)}\0${direction}`
    );
    return {
      route: "cross-column",
      direction,
      startGutterIndex: Math.max(startGutterIndex, endGutterIndex),
      endGutterIndex: Math.max(startGutterIndex, endGutterIndex),
      startLaneIndex: laneIndex,
      endLaneIndex: laneIndex
    };
  }

  return {
    route: "cross-column",
    direction,
    startGutterIndex,
    endGutterIndex,
    startLaneIndex: consumeDependencyLaneIndex(
      laneState?.gutterLaneCountsByKey,
      `${startGutterIndex}\0${direction}`
    ),
    endLaneIndex: consumeDependencyLaneIndex(
      laneState?.gutterLaneCountsByKey,
      `${endGutterIndex}\0${direction}`
    )
  };
}

export function assignDependencyEdgePorts(edges) {
  const edgePortMeta = (edges ?? []).map(() => ({
    sourcePortIndex: 0,
    sourcePortCount: 1,
    targetPortIndex: 0,
    targetPortCount: 1
  }));
  const endpointsByNodeSideKey = new Map();

  for (const [edgeIndex, edge] of (edges ?? []).entries()) {
    const sourceSide = dependencyEdgeEndpointSide(edge?.laneMeta, "source");
    if (edge?.source && sourceSide) {
      const endpointKey = `${edge.source.id}\0${sourceSide}`;
      const endpoints = endpointsByNodeSideKey.get(endpointKey) ?? [];
      endpoints.push({
        edgeIndex,
        role: "source",
        nodeId: edge.source.id,
        peerY: edge.target ? edge.target.y + edge.target.height / 2 : edge.source.y + edge.source.height / 2,
        edgeId: edge.edge?.id ?? String(edgeIndex)
      });
      endpointsByNodeSideKey.set(endpointKey, endpoints);
    }

    const targetSide = dependencyEdgeEndpointSide(edge?.laneMeta, "target");
    if (edge?.target && targetSide) {
      const endpointKey = `${edge.target.id}\0${targetSide}`;
      const endpoints = endpointsByNodeSideKey.get(endpointKey) ?? [];
      endpoints.push({
        edgeIndex,
        role: "target",
        nodeId: edge.target.id,
        peerY: edge.source ? edge.source.y + edge.source.height / 2 : edge.target.y + edge.target.height / 2,
        edgeId: edge.edge?.id ?? String(edgeIndex)
      });
      endpointsByNodeSideKey.set(endpointKey, endpoints);
    }
  }

  for (const endpoints of endpointsByNodeSideKey.values()) {
    endpoints.sort(compareDependencyEdgeEndpoints);
    const portCount = endpoints.length;

    for (const [portIndex, endpoint] of endpoints.entries()) {
      const meta = edgePortMeta[endpoint.edgeIndex];
      if (endpoint.role === "source") {
        meta.sourcePortIndex = portIndex;
        meta.sourcePortCount = portCount;
        continue;
      }

      meta.targetPortIndex = portIndex;
      meta.targetPortCount = portCount;
    }
  }

  return edgePortMeta;
}

export function fitDependencyGraphLayoutToBounds(layout, options = {}) {
  const padding = Number.isFinite(Number(options.padding))
    ? Math.max(0, Math.trunc(Number(options.padding)))
    : 28;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const includePoint = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const directory of layout?.directories ?? []) {
    includePoint(directory?.x, directory?.y);
    includePoint(
      Number(directory?.x) + Number(directory?.width),
      Number(directory?.y) + Number(directory?.height)
    );
  }

  for (const node of layout?.nodes ?? []) {
    includePoint(node?.x, node?.y);
    includePoint(Number(node?.x) + Number(node?.width), Number(node?.y) + Number(node?.height));
  }

  for (const edge of layout?.edges ?? []) {
    for (const point of edge?.points ?? []) {
      includePoint(point?.x, point?.y);
    }
  }

  const widthFloor = Math.max(320, Math.trunc(Number(layout?.width) || 0));
  const heightFloor = Math.max(220, Math.trunc(Number(layout?.height) || 0));
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return {
      ...layout,
      width: widthFloor,
      height: heightFloor
    };
  }

  const shiftX = Math.max(0, padding - minX);
  const shiftY = Math.max(0, padding - minY);

  return {
    ...layout,
    width: Math.max(widthFloor + shiftX, maxX + shiftX + padding),
    height: Math.max(heightFloor + shiftY, maxY + shiftY + padding),
    directories: (layout?.directories ?? []).map((directory) => ({
      ...directory,
      x: directory.x + shiftX,
      y: directory.y + shiftY
    })),
    nodes: (layout?.nodes ?? []).map((node) => ({
      ...node,
      x: node.x + shiftX,
      y: node.y + shiftY
    })),
    edges: (layout?.edges ?? []).map((edge) => ({
      ...edge,
      points: (edge?.points ?? []).map((point) => ({
        x: point.x + shiftX,
        y: point.y + shiftY
      }))
    }))
  };
}

export function pointsForDependencyEdge(source, sourceDirectory, target, targetDirectory, columnLayouts, laneMeta, endpointPorts = null) {
  const sourceY = dependencyNodePortY(source, endpointPorts?.sourcePortIndex, endpointPorts?.sourcePortCount);
  const targetY = dependencyNodePortY(target, endpointPorts?.targetPortIndex, endpointPorts?.targetPortCount);
  const outerLaneOffset = 18;
  const outerLaneSpacing = 16;
  const gutterLaneSpacing = 12;

  if (!laneMeta) {
    return [];
  }

  if (laneMeta.route === "same-column") {
    const useLeftSide = laneMeta.side === "left";
    const sourceX = useLeftSide ? source.x : source.x + source.width;
    const targetX = useLeftSide ? target.x : target.x + target.width;
    const laneX = useLeftSide
      ? sourceDirectory.x - outerLaneOffset - laneMeta.laneIndex * outerLaneSpacing
      : sourceDirectory.x + sourceDirectory.width + outerLaneOffset + laneMeta.laneIndex * outerLaneSpacing;

    return [
      { x: sourceX, y: sourceY },
      { x: laneX, y: sourceY },
      { x: laneX, y: targetY },
      { x: targetX, y: targetY }
    ];
  }

  const startGutterX = dependencyGutterCenterX(columnLayouts, laneMeta.startGutterIndex, laneMeta.startLaneIndex, gutterLaneSpacing);
  const endGutterX = dependencyGutterCenterX(columnLayouts, laneMeta.endGutterIndex, laneMeta.endLaneIndex, gutterLaneSpacing);
  if (startGutterX === null || endGutterX === null) {
    return [];
  }

  const direction = laneMeta.direction === "leftward" ? "leftward" : "rightward";
  const sourceX = direction === "rightward" ? source.x + source.width : source.x;
  const targetX = direction === "rightward" ? target.x : target.x + target.width;
  const points = [
    { x: sourceX, y: sourceY },
    { x: startGutterX, y: sourceY },
    { x: startGutterX, y: targetY }
  ];

  if (endGutterX !== startGutterX) {
    points.push({ x: endGutterX, y: targetY });
  }

  points.push({ x: targetX, y: targetY });
  return points;
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

function chooseSameColumnDependencyEdgeSide(source, target, columnIndex, columnCount, laneCountsByKey) {
  const leftCount = readDependencyLaneCount(laneCountsByKey, `${columnIndex}\0left`);
  const rightCount = readDependencyLaneCount(laneCountsByKey, `${columnIndex}\0right`);
  if (leftCount !== rightCount) {
    return leftCount < rightCount ? "left" : "right";
  }

  const sourceY = Number(source?.y) + Number(source?.height ?? 0) / 2;
  const targetY = Number(target?.y) + Number(target?.height ?? 0) / 2;
  if (targetY < sourceY) {
    return "left";
  }
  if (targetY > sourceY) {
    return "right";
  }

  if (columnIndex === 0) {
    return "left";
  }
  if (columnIndex === Math.max(0, columnCount - 1)) {
    return "right";
  }
  return "right";
}

function consumeDependencyLaneIndex(laneCountsByKey, key) {
  if (!(laneCountsByKey instanceof Map)) {
    return 0;
  }

  const laneIndex = laneCountsByKey.get(key) ?? 0;
  laneCountsByKey.set(key, laneIndex + 1);
  return laneIndex;
}

function readDependencyLaneCount(laneCountsByKey, key) {
  if (!(laneCountsByKey instanceof Map)) {
    return 0;
  }
  return laneCountsByKey.get(key) ?? 0;
}

function dependencyEdgeEndpointSide(laneMeta, role) {
  if (!laneMeta) {
    return null;
  }

  if (laneMeta.route === "same-column") {
    return laneMeta.side === "left" ? "left" : "right";
  }

  if (laneMeta.direction === "leftward") {
    return role === "source" ? "left" : "right";
  }

  return role === "source" ? "right" : "left";
}

function dependencyNodePortY(node, portIndex, portCount) {
  const nodeTop = Number(node?.y);
  const nodeHeight = Number(node?.height);
  if (!Number.isFinite(nodeTop) || !Number.isFinite(nodeHeight)) {
    return 0;
  }

  const centerY = nodeTop + nodeHeight / 2;
  const normalizedPortCount = Number.isFinite(portCount) ? Math.max(1, Math.trunc(portCount)) : 1;
  if (normalizedPortCount === 1) {
    return centerY;
  }

  const normalizedPortIndex = Number.isFinite(portIndex)
    ? Math.max(0, Math.min(normalizedPortCount - 1, Math.trunc(portIndex)))
    : Math.floor(normalizedPortCount / 2);
  const inset = Math.min(14, Math.max(8, nodeHeight * 0.22), nodeHeight / 2);
  const availableHeight = Math.max(0, nodeHeight - inset * 2);
  if (availableHeight === 0) {
    return centerY;
  }

  return nodeTop + inset + normalizedPortIndex * (availableHeight / Math.max(1, normalizedPortCount - 1));
}

function dependencyGutterCenterX(columnLayouts, gutterIndex, laneIndex, laneSpacing) {
  if (!Array.isArray(columnLayouts) || gutterIndex < 0 || gutterIndex >= columnLayouts.length - 1) {
    return null;
  }

  const leftColumn = columnLayouts[gutterIndex];
  const rightColumn = columnLayouts[gutterIndex + 1];
  const gutterCenterX = (leftColumn.x + leftColumn.width + rightColumn.x) / 2;
  return gutterCenterX + dependencyLaneOffset(laneIndex, laneSpacing);
}

function dependencyLaneOffset(laneIndex, laneSpacing) {
  if (!Number.isFinite(laneIndex) || laneIndex <= 0) {
    return 0;
  }

  const magnitude = Math.ceil(laneIndex / 2) * laneSpacing;
  return laneIndex % 2 === 1 ? magnitude : -magnitude;
}

function compareDependencyEdgeEndpoints(left, right) {
  if (left.peerY !== right.peerY) {
    return left.peerY - right.peerY;
  }
  if (left.role !== right.role) {
    return left.role.localeCompare(right.role);
  }
  if (left.nodeId !== right.nodeId) {
    return left.nodeId.localeCompare(right.nodeId);
  }
  return String(left.edgeId).localeCompare(String(right.edgeId));
}
