import {
  clampAnchorLine as clampAnchorLineLogic,
  compareFilesForSortMode as compareFilesForSortModeLogic,
  countReferences as countReferencesLogic,
  compareSymbols as compareSymbolsLogic,
  countPatchLineTotals as countPatchLineTotalsLogic,
  countUsagesInDiff as countUsagesInDiffLogic,
  filterLocalSymbolsForTopLevel as filterLocalSymbolsForTopLevelLogic,
  fileNameForPath as fileNameForPathLogic,
  folderForPath as folderForPathLogic,
  formatLineNumber as formatLineNumberLogic,
  getChangeKindForFile as getChangeKindForFileLogic,
  getChangeKindForSymbolPure,
  getLineNumberColumnWidth as getLineNumberColumnWidthLogic,
  getShikiLanguageCandidates as getShikiLanguageCandidatesLogic,
  getTargetSelectionForSymbol as getTargetSelectionForSymbolLogic,
  groupFilesByFolder as groupFilesByFolderLogic,
  isLineInTargetSelection as isLineInTargetSelectionLogic,
  markerForRowType as markerForRowTypeLogic,
  normalizeChangeKind as normalizeChangeKindLogic,
  normalizeSortMode as normalizeSortModeLogic,
  normalizeTargetSelection as normalizeTargetSelectionLogic,
  parseUnifiedPatch as parseUnifiedPatchLogic
} from "./logic.js";

const state = {
  bootstrap: null,
  selectedSymbolId: null,
  selectedFilePath: null,
  expandedFilePaths: new Set(),
  expandedTopLevelId: null,
  sortMode: "usages",
  usagesBySymbolId: new Map(),
  usageInDiffCountBySymbolId: new Map(),
  usageSortCountsLoading: false,
  loadedFilePath: null,
  loadedFileContent: undefined,
  fileContentRequestsByPath: new Map(),
  patchRowsByFilePath: new Map(),
  renderRequestId: 0,
  paneSizes: null,
  shikiModulePromise: null,
  shikiUnavailable: false
};

const SHIKI_THEME = "github-light";
const SHIKI_IMPORT_URL = "https://esm.sh/shiki@3.14.0?bundle";
const PANE_LAYOUT_STORAGE_KEY = "argus-pane-layout-v1";
const PANE_RESIZE_STEP_PX = 24;
const PANE_DEFAULT_SIZE_BY_KEY = Object.freeze({
  symbols: 19.5,
  code: 58,
  usages: 22.5
});
const PANE_MIN_WIDTH_BY_KEY = Object.freeze({
  symbols: 230,
  code: 350,
  usages: 260
});
state.paneSizes = { ...PANE_DEFAULT_SIZE_BY_KEY };

const symbolsListElement = document.getElementById("symbols-list");
const codeTitleElement = document.getElementById("code-title");
const codeViewElement = document.getElementById("code-view");
const usagesTitleElement = document.getElementById("usages-title");
const usagesListElement = document.getElementById("usages-list");
const reviewMetaElement = document.getElementById("review-meta");
const diffStatsElement = document.getElementById("diff-stats");
const symbolsSortElement = document.getElementById("symbols-sort");
const layoutElement = document.querySelector(".layout");
const paneSymbolsElement = document.querySelector(".pane-symbols");
const paneCodeElement = document.querySelector(".pane-code");
const paneUsagesElement = document.querySelector(".pane-usages");
const symbolsCodeResizerElement = document.querySelector('[data-resizer="symbols-code"]');
const codeUsagesResizerElement = document.querySelector('[data-resizer="code-usages"]');

initializeSortControl();
initializePaneResizers();
setUsagesPaneVisible(false);
void initialize();

async function initialize() {
  try {
    const bootstrap = await fetchJson("/api/bootstrap");
    state.bootstrap = bootstrap;
    state.expandedFilePaths = new Set(bootstrap.files.map((file) => file.path));
    state.patchRowsByFilePath.clear();
    if (state.sortMode === "usages") {
      void ensureUsageSortCountsLoaded();
    }

    renderMeta();
    const files = getFilesSorted();
    if (files.length === 0) {
      renderSymbolList();
      renderEmptyReview();
      return;
    }

    selectFile(files[0].path);
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Unable to load review.");
  }
}

function renderMeta() {
  const { review, files } = state.bootstrap;
  const comparisonLabel =
    review.mode === "working-tree" ? "HEAD...WORKTREE" : `${review.defaultBranch}...HEAD`;
  reviewMetaElement.textContent = `${comparisonLabel} | files ${files.length}`;
  const lineTotals = countDiffLineTotals(files);
  if (diffStatsElement) {
    diffStatsElement.textContent = `+${lineTotals.added} added | -${lineTotals.removed} removed`;
  }
}

function renderEmptyReview() {
  codeTitleElement.textContent = "File";
  codeViewElement.innerHTML = `<div class="empty">No touched declarations were detected in this diff.</div>`;
  usagesTitleElement.textContent = "Usages";
  usagesListElement.innerHTML = `<div class="empty">Nothing to show.</div>`;
  setUsagesPaneVisible(false);
}

function renderNoSelection(filePath) {
  usagesTitleElement.textContent = "Usages";
  if (filePath) {
    usagesListElement.innerHTML = `<div class="empty">Select a symbol in ${escapeHtml(filePath)} to load usages.</div>`;
  } else {
    usagesListElement.innerHTML = `<div class="empty">Select a file or symbol to load usages.</div>`;
  }
  setUsagesPaneVisible(false);
}

function renderSymbolList() {
  const files = getFilesSorted();
  syncSymbolLineColumnWidth();
  symbolsListElement.innerHTML = "";

  if (files.length === 0) {
    symbolsListElement.innerHTML = `<div class="empty">No files found.</div>`;
    return;
  }

  for (const folderGroup of groupFilesByFolder(files)) {
    const folderContainer = document.createElement("div");
    folderContainer.className = "folder-group";

    const folderTitle = document.createElement("div");
    folderTitle.className = "folder-header";
    folderTitle.textContent = folderGroup.folder;
    folderContainer.appendChild(folderTitle);

    for (const file of folderGroup.files) {
      const topLevelSymbols = getTopLevelSymbolsForFile(file.path);
      const fileHasChildren = topLevelSymbols.length > 0;
      const fileIsExpanded = fileHasChildren && isFileExpanded(file.path);
      const fileItem = createFileItem(file, {
        hasChildren: fileHasChildren,
        isExpanded: fileIsExpanded
      });
      folderContainer.appendChild(fileItem);

      if (!fileIsExpanded) {
        continue;
      }

      const patchRows = getPatchRowsForFile(file.path);
      for (const topLevelSymbol of topLevelSymbols) {
        const topLevelChangeKind = getChangeKindForSymbolPure(topLevelSymbol, file, patchRows);
        const localSymbols = filterLocalSymbolsForTopLevel(
          getLocalSymbolsForTopLevel(file.path, topLevelSymbol.id),
          topLevelSymbol,
          file,
          patchRows
        );
        const topLevelItem = createSymbolItem(topLevelSymbol, "symbol-item symbol-item-top-level", {
          hasChildren: localSymbols.length > 0,
          changeKind: topLevelChangeKind,
          rowClass: "symbol-row-top-level"
        });
        folderContainer.appendChild(topLevelItem);

        if (state.expandedTopLevelId !== topLevelSymbol.id) {
          continue;
        }

        for (const localSymbol of localSymbols) {
          const localItem = createSymbolItem(localSymbol, "symbol-item symbol-item-local", {
            changeKind: getChangeKindForSymbolPure(localSymbol, file, patchRows),
            rowClass: "symbol-row-local"
          });
          folderContainer.appendChild(localItem);
        }
      }
    }

    symbolsListElement.appendChild(folderContainer);
  }
}

function createFileItem(file, options = {}) {
  const hasChildren = options.hasChildren === true;
  const isExpanded = hasChildren && options.isExpanded === true;
  const item = document.createElement("button");
  item.type = "button";
  item.className = "symbol-item file-item";
  item.classList.add(`change-${getChangeKindForFile(file)}`);
  if (state.selectedFilePath === file.path && (state.selectedSymbolId === null || !isExpanded)) {
    item.classList.add("selected");
  }

  const main = document.createElement("div");
  main.className = "symbol-main";

  if (hasChildren) {
    main.appendChild(
      createExpanderControl({
        isExpanded,
        label: file.path,
        onToggle: () => toggleFileExpansion(file.path)
      })
    );
  }

  const title = document.createElement("div");
  title.className = "symbol-title";
  title.textContent = fileNameForPath(file.path);

  main.appendChild(title);
  item.appendChild(main);
  item.addEventListener("click", () => {
    selectFile(file.path);
  });

  return item;
}

function createSymbolItem(symbol, className, options = {}) {
  const hasChildren = options.hasChildren === true;
  const isExpanded = state.expandedTopLevelId === symbol.id;
  const row = document.createElement("div");
  row.className = "symbol-row";
  if (typeof options.rowClass === "string" && options.rowClass.length > 0) {
    row.classList.add(options.rowClass);
  }

  const line = document.createElement("span");
  line.className = "symbol-line";
  line.textContent = String(symbol.declaration.line);

  const item = document.createElement("button");
  item.type = "button";
  item.className = className;
  const changeKind = normalizeChangeKind(options.changeKind) ?? getChangeKindForSymbol(symbol);
  item.classList.add(`change-${changeKind}`);
  if (symbol.id === state.selectedSymbolId) {
    item.classList.add("selected");
  }
  if (isExpanded) {
    item.classList.add("expanded");
  }

  const main = document.createElement("div");
  main.className = "symbol-main";

  const title = document.createElement("div");
  title.className = "symbol-title";
  title.textContent =
    symbol.kind === "unknown" ? symbol.name : `${symbol.kind} ${symbol.name}`;

  if (hasChildren) {
    main.appendChild(
      createExpanderControl({
        isExpanded,
        label: symbol.name,
        onToggle: () => toggleTopLevelExpansion(symbol.id)
      })
    );
  }
  main.appendChild(title);
  item.appendChild(main);
  row.appendChild(line);
  row.appendChild(item);

  item.addEventListener("click", () => {
    if (hasChildren && state.selectedSymbolId === symbol.id) {
      toggleTopLevelExpansion(symbol.id);
      return;
    }
    void selectSymbol(symbol.id);
  });

  return row;
}

function createExpanderControl({ isExpanded, label, onToggle }) {
  const expander = document.createElement("span");
  expander.className = "symbol-expander";
  expander.role = "button";
  expander.tabIndex = 0;
  expander.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  expander.setAttribute("aria-label", `${isExpanded ? "Collapse" : "Expand"} ${label}`);
  expander.textContent = isExpanded ? "v" : ">";
  expander.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  });
  expander.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  });
  return expander;
}

function selectFile(filePath) {
  const file = findFile(filePath);
  if (!file) {
    return;
  }

  expandFilePath(filePath);
  state.selectedFilePath = filePath;
  state.selectedSymbolId = null;
  state.expandedTopLevelId = null;
  renderSymbolList();
  renderFile(filePath, null);
  renderNoSelection(filePath);
}

async function selectSymbol(symbolId) {
  state.selectedSymbolId = symbolId;
  const selectedSymbol = findSymbol(symbolId);
  state.selectedFilePath = selectedSymbol?.declaration.filePath ?? null;
  if (state.selectedFilePath) {
    expandFilePath(state.selectedFilePath);
  }
  collapseExpandedChildrenForSelection(selectedSymbol);
  renderSymbolList();

  const symbol = selectedSymbol;
  if (!symbol) {
    return;
  }

  renderFile(symbol.declaration.filePath, getTargetSelectionForSymbol(symbol));
  await ensureUsagesLoaded(symbolId);
  renderUsages(symbolId);
}

function toggleTopLevelExpansion(topLevelSymbolId) {
  if (state.expandedTopLevelId === topLevelSymbolId) {
    state.expandedTopLevelId = null;
  } else {
    state.expandedTopLevelId = topLevelSymbolId;
  }
  renderSymbolList();
}

function toggleFileExpansion(filePath) {
  if (!findFile(filePath)) {
    return;
  }

  if (isFileExpanded(filePath)) {
    state.expandedFilePaths.delete(filePath);
  } else {
    state.expandedFilePaths.add(filePath);
  }
  renderSymbolList();
}

function expandFilePath(filePath) {
  if (!findFile(filePath)) {
    return;
  }

  state.expandedFilePaths.add(filePath);
}

function collapseExpandedChildrenForSelection(selectedSymbol) {
  const expandedTopLevelId = state.expandedTopLevelId;
  if (!expandedTopLevelId) {
    return;
  }

  if (!selectedSymbol) {
    state.expandedTopLevelId = null;
    return;
  }

  if (selectedSymbol.scope === "local" && selectedSymbol.topLevelSymbolId === expandedTopLevelId) {
    return;
  }

  if (selectedSymbol.scope === "top-level" && selectedSymbol.id === expandedTopLevelId) {
    return;
  }

  state.expandedTopLevelId = null;
}

async function ensureUsagesLoaded(symbolId) {
  if (state.usagesBySymbolId.has(symbolId)) {
    return;
  }

  usagesTitleElement.textContent = "Usages";
  usagesListElement.innerHTML = "";
  setUsagesPaneVisible(false);

  const payload = await fetchJson("/api/usages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ symbolId })
  });
  state.usagesBySymbolId.set(symbolId, payload);
  state.usageInDiffCountBySymbolId.set(symbolId, countUsagesInDiff(payload.usages));
}

function renderUsages(symbolId) {
  const symbolPayload = state.usagesBySymbolId.get(symbolId);
  const symbol = findSymbol(symbolId);
  usagesListElement.innerHTML = "";

  if (!symbolPayload || !symbol) {
    usagesTitleElement.textContent = "Usages";
    usagesListElement.innerHTML = `<div class="empty">No usage data.</div>`;
    setUsagesPaneVisible(false);
    return;
  }

  usagesTitleElement.textContent = `Usages of ${symbol.name} (${symbolPayload.usages.length})`;

  if (countReferences(symbolPayload.usages) === 0) {
    usagesTitleElement.textContent = "Usages";
    usagesListElement.innerHTML = "";
    setUsagesPaneVisible(false);
    return;
  }

  setUsagesPaneVisible(true);

  const diffFileSet = new Set((state.bootstrap?.files ?? []).map((file) => file.path));
  const usagesInDiff = [];
  const usagesInFilesWithDiff = [];
  const usagesInFilesWithoutDiff = [];

  for (const usage of symbolPayload.usages) {
    if (usage.isInDiff) {
      usagesInDiff.push(usage);
      continue;
    }

    if (diffFileSet.has(usage.location.filePath)) {
      usagesInFilesWithDiff.push(usage);
    } else {
      usagesInFilesWithoutDiff.push(usage);
    }
  }

  usagesListElement.appendChild(createUsageSection("In diff", usagesInDiff));
  usagesListElement.appendChild(createUsageSection("In files with diff", usagesInFilesWithDiff));
  usagesListElement.appendChild(createUsageSection("In files without diff", usagesInFilesWithoutDiff));
}

function createUsageSection(title, usages) {
  const section = document.createElement("section");
  section.className = "usage-section";

  const header = document.createElement("div");
  header.className = "usage-section-title";
  header.textContent = `${title} (${usages.length})`;
  section.appendChild(header);

  if (usages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "usage-section-empty";
    empty.textContent = "None";
    section.appendChild(empty);
    return section;
  }

  for (const usage of usages) {
    section.appendChild(createUsageItem(usage));
  }

  return section;
}

function createUsageItem(usage) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "usage-item";

  const top = document.createElement("div");
  top.className = "usage-top";
  const definitionFlag = usage.isDefinition ? "definition" : "reference";
  top.textContent = `${usage.location.filePath}:${usage.location.line}:${usage.location.column} | ${definitionFlag}`;

  const preview = document.createElement("div");
  preview.className = "usage-preview";
  preview.textContent = usage.preview || "(empty line)";

  item.appendChild(top);
  item.appendChild(preview);
  item.addEventListener("click", () => {
    expandFilePath(usage.location.filePath);
    state.selectedFilePath = usage.location.filePath;
    renderSymbolList();
    renderFile(usage.location.filePath, usage.location.line);
  });

  return item;
}

function renderFile(filePath, target) {
  const renderRequestId = ++state.renderRequestId;
  const targetSelection = normalizeTargetSelection(target);
  const file = findFile(filePath);
  codeTitleElement.textContent = `${filePath}`;

  if (!file) {
    codeViewElement.innerHTML = `<div class="empty">File not present in bootstrap payload.</div>`;
    return;
  }

  if (!targetSelection) {
    codeViewElement.scrollTop = 0;
  }

  const diffRows = parseUnifiedPatch(file.patch);
  if (file.status === "deleted") {
    state.loadedFilePath = filePath;
    state.loadedFileContent = null;
    if (diffRows.length === 0) {
      codeViewElement.innerHTML = `<div class="empty">File is deleted on HEAD.</div>`;
      return;
    }
    renderPatchRows(diffRows, targetSelection);
    return;
  }

  const inlineContent = typeof file.content === "string" ? file.content : null;
  if (state.loadedFilePath === filePath && typeof state.loadedFileContent === "string") {
    renderFullFileWithDiff(state.loadedFileContent, diffRows, targetSelection, null);
    void applySyntaxHighlighting(filePath, state.loadedFileContent, renderRequestId);
    return;
  }

  if (inlineContent !== null) {
    state.loadedFilePath = filePath;
    state.loadedFileContent = inlineContent;
    renderFullFileWithDiff(inlineContent, diffRows, targetSelection, null);
    void applySyntaxHighlighting(filePath, inlineContent, renderRequestId);
    return;
  }

  state.loadedFilePath = filePath;
  state.loadedFileContent = undefined;
  renderFileLoading();
  void loadAndRenderFileContent(filePath, diffRows, targetSelection, renderRequestId);
}

function renderFullFileWithDiff(fileContent, diffRows, targetSelection, highlightedLines) {
  const lines = fileContent.split(/\r?\n/);
  const addedLines = new Set();
  const removedByAnchor = new Map();

  for (const diffRow of diffRows) {
    if (diffRow.type === "added" && diffRow.newLine !== null) {
      addedLines.add(diffRow.newLine);
      continue;
    }

    if (diffRow.type === "removed") {
      const anchorLine = clampAnchorLine(diffRow.anchorNewLine, lines.length);
      const bucket = removedByAnchor.get(anchorLine) ?? [];
      bucket.push(diffRow);
      removedByAnchor.set(anchorLine, bucket);
    }
  }

  codeViewElement.innerHTML = "";
  const fragment = document.createDocumentFragment();
  let targetRow = null;

  for (let lineNumber = 1; lineNumber <= lines.length; lineNumber += 1) {
    const removedRows = removedByAnchor.get(lineNumber) ?? [];
    for (const removedRow of removedRows) {
      const row = createDiffRow({
        type: "removed",
        oldLine: removedRow.oldLine,
        newLine: null,
        text: removedRow.text
      });
      if (targetSelection?.includeRemovedRows && isLineInTargetSelection(lineNumber, targetSelection)) {
        row.classList.add("target");
        if (!targetRow && targetSelection && lineNumber === targetSelection.focusLine) {
          targetRow = row;
        }
        if (!targetRow) {
          targetRow = row;
        }
      }
      fragment.appendChild(row);
    }

    const row = createDiffRow({
      type: addedLines.has(lineNumber) ? "added" : "context",
      oldLine: null,
      newLine: lineNumber,
      text: lines[lineNumber - 1],
      html: highlightedLines ? highlightedLines[lineNumber - 1] ?? null : null
    });
    if ((targetSelection?.includeCurrentRows ?? true) && isLineInTargetSelection(lineNumber, targetSelection)) {
      row.classList.add("target");
      if (!targetRow && targetSelection && lineNumber === targetSelection.focusLine) {
        targetRow = row;
      }
      if (!targetRow) {
        targetRow = row;
      }
    }
    row.dataset.line = String(lineNumber);
    fragment.appendChild(row);
  }

  const trailingRemovedRows = removedByAnchor.get(lines.length + 1) ?? [];
  for (const removedRow of trailingRemovedRows) {
    const row = createDiffRow({
      type: "removed",
      oldLine: removedRow.oldLine,
      newLine: null,
      text: removedRow.text
    });
    if (targetSelection?.includeRemovedRows && isLineInTargetSelection(lines.length + 1, targetSelection)) {
      row.classList.add("target");
      if (!targetRow) {
        targetRow = row;
      }
    }
    fragment.appendChild(row);
  }

  const diffBlock = document.createElement("div");
  diffBlock.className = "diff-block";
  diffBlock.appendChild(fragment);
  codeViewElement.appendChild(diffBlock);
  decorateTargetRows(diffBlock);

  if (targetRow) {
    targetRow.scrollIntoView({ block: "center" });
  }
}

function renderPatchRows(diffRows, targetSelection) {
  codeViewElement.innerHTML = "";
  const fragment = document.createDocumentFragment();
  let targetRow = null;

  for (const diffRow of diffRows) {
    const row = createDiffRow(diffRow);
    let rowTargetLine = null;

    if (
      (targetSelection?.includeCurrentRows ?? true) &&
      diffRow.type !== "removed" &&
      diffRow.type !== "hunk" &&
      diffRow.type !== "meta" &&
      diffRow.newLine !== null
    ) {
      rowTargetLine = diffRow.newLine;
    } else if (targetSelection?.includeRemovedRows && diffRow.type === "removed" && diffRow.anchorNewLine !== null) {
      rowTargetLine = diffRow.anchorNewLine;
    }

    if (targetSelection && rowTargetLine !== null && isLineInTargetSelection(rowTargetLine, targetSelection)) {
      row.classList.add("target");
      if (!targetRow && rowTargetLine === targetSelection.focusLine) {
        targetRow = row;
      }
      if (!targetRow) {
        targetRow = row;
      }
    }

    if (diffRow.newLine !== null) {
      row.dataset.line = String(diffRow.newLine);
    }

    fragment.appendChild(row);
  }
  const diffBlock = document.createElement("div");
  diffBlock.className = "diff-block";
  diffBlock.appendChild(fragment);
  codeViewElement.appendChild(diffBlock);
  decorateTargetRows(diffBlock);

  if (targetRow) {
    targetRow.scrollIntoView({ block: "center" });
  }
}

function normalizeTargetSelection(target) {
  return normalizeTargetSelectionLogic(target);
}

function isLineInTargetSelection(lineNumber, targetSelection) {
  return isLineInTargetSelectionLogic(lineNumber, targetSelection);
}

function decorateTargetRows(diffBlock) {
  const targetRows = [...diffBlock.querySelectorAll(".diff-line.target")];
  for (const targetRow of targetRows) {
    targetRow.classList.remove("target-block-single", "target-block-start", "target-block-middle", "target-block-end");
  }

  for (const targetRow of targetRows) {
    const previousIsTarget = targetRow.previousElementSibling?.classList.contains("target") ?? false;
    const nextIsTarget = targetRow.nextElementSibling?.classList.contains("target") ?? false;

    if (!previousIsTarget && !nextIsTarget) {
      targetRow.classList.add("target-block-single");
      continue;
    }

    if (!previousIsTarget) {
      targetRow.classList.add("target-block-start");
      continue;
    }

    if (!nextIsTarget) {
      targetRow.classList.add("target-block-end");
      continue;
    }

    targetRow.classList.add("target-block-middle");
  }
}

function createDiffRow(diffRow) {
  const row = document.createElement("div");
  row.className = `diff-line diff-${diffRow.type}`;

  const oldGutter = document.createElement("span");
  oldGutter.className = "diff-gutter";
  oldGutter.textContent = formatLineNumber(diffRow.oldLine);

  const newGutter = document.createElement("span");
  newGutter.className = "diff-gutter";
  newGutter.textContent = formatLineNumber(diffRow.newLine);

  const marker = document.createElement("span");
  marker.className = "diff-marker";
  marker.textContent = markerForRowType(diffRow.type);

  const content = document.createElement("span");
  content.className = "diff-content";
  if (typeof diffRow.html === "string") {
    content.innerHTML = diffRow.html.length > 0 ? diffRow.html : " ";
  } else {
    content.textContent = diffRow.text.length > 0 ? diffRow.text : " ";
  }

  row.appendChild(oldGutter);
  row.appendChild(newGutter);
  row.appendChild(marker);
  row.appendChild(content);

  return row;
}

async function applySyntaxHighlighting(filePath, fileContent, renderRequestId) {
  const highlightedLines = await getHighlightedLines(filePath, fileContent);
  if (!highlightedLines) {
    return;
  }

  if (renderRequestId !== state.renderRequestId) {
    return;
  }

  if (state.selectedFilePath !== filePath) {
    return;
  }

  applyHighlightedLinesToRenderedFile(highlightedLines);
}

function renderFileLoading() {
  codeViewElement.innerHTML = `<div class="empty">Loading file...</div>`;
}

function renderFileLoadError(message) {
  codeViewElement.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
}

function renderError(message) {
  reviewMetaElement.textContent = "Failed to load review";
  if (diffStatsElement) {
    diffStatsElement.textContent = "";
  }
  symbolsListElement.innerHTML = "";
  codeViewElement.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  usagesListElement.innerHTML = `<div class="empty">No data.</div>`;
  setUsagesPaneVisible(false);
}

function countDiffLineTotals(files) {
  let added = 0;
  let removed = 0;

  for (const file of files ?? []) {
    const fileTotals = countPatchLineTotals(file.patch);
    added += fileTotals.added;
    removed += fileTotals.removed;
  }

  return {
    added,
    removed
  };
}

function findSymbol(symbolId) {
  return state.bootstrap?.symbols.find((symbol) => symbol.id === symbolId) ?? null;
}

function findFile(filePath) {
  return state.bootstrap?.files.find((file) => file.path === filePath) ?? null;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed: ${response.status}`);
  }
  return response.json();
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function getHighlightedLines(filePath, fileContent) {
  const languageCandidates = getShikiLanguageCandidates(filePath);
  if (languageCandidates.length === 0) {
    return null;
  }

  const shiki = await getShikiModule();
  if (!shiki || typeof shiki.codeToHtml !== "function") {
    return null;
  }

  for (const language of languageCandidates) {
    try {
      const highlightedHtml = await shiki.codeToHtml(fileContent, {
        lang: language,
        theme: SHIKI_THEME
      });
      return extractHighlightedLines(highlightedHtml);
    } catch {
      continue;
    }
  }

  return null;
}

async function loadAndRenderFileContent(filePath, diffRows, targetSelection, renderRequestId) {
  try {
    const fileContent = await ensureFileContentLoaded(filePath);
    if (renderRequestId !== state.renderRequestId) {
      return;
    }

    if (state.selectedFilePath !== filePath) {
      return;
    }

    state.loadedFilePath = filePath;
    state.loadedFileContent = fileContent;
    renderFullFileWithDiff(fileContent, diffRows, targetSelection, null);
    void applySyntaxHighlighting(filePath, fileContent, renderRequestId);
  } catch (error) {
    if (renderRequestId !== state.renderRequestId) {
      return;
    }

    if (state.selectedFilePath !== filePath) {
      return;
    }

    renderFileLoadError(error instanceof Error ? error.message : `Unable to load ${filePath}.`);
  }
}

async function ensureFileContentLoaded(filePath) {
  if (state.loadedFilePath === filePath && typeof state.loadedFileContent === "string") {
    return state.loadedFileContent;
  }

  const inFlightRequest = state.fileContentRequestsByPath.get(filePath);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const query = new URLSearchParams({ path: filePath });
  const request = fetchJson(`/api/file?${query.toString()}`)
    .then((payload) => {
      if (!payload || payload.filePath !== filePath) {
        throw new Error(`Unexpected file response for ${filePath}.`);
      }

      if (typeof payload.content !== "string") {
        throw new Error(`File content is unavailable for ${filePath}.`);
      }

      return payload.content;
    })
    .finally(() => {
      state.fileContentRequestsByPath.delete(filePath);
    });

  state.fileContentRequestsByPath.set(filePath, request);
  return request;
}

function applyHighlightedLinesToRenderedFile(highlightedLines) {
  const currentRows = codeViewElement.querySelectorAll(".diff-line[data-line]");
  for (const row of currentRows) {
    const lineNumber = Number.parseInt(row.dataset.line ?? "", 10);
    if (!Number.isFinite(lineNumber) || lineNumber < 1) {
      continue;
    }

    const content = row.querySelector(".diff-content");
    if (!(content instanceof HTMLElement)) {
      continue;
    }

    content.innerHTML = highlightedLines[lineNumber - 1] ?? " ";
  }
}

async function getShikiModule() {
  if (state.shikiUnavailable) {
    return null;
  }

  if (!state.shikiModulePromise) {
    state.shikiModulePromise = loadShikiModule();
  }

  return state.shikiModulePromise;
}

async function loadShikiModule() {
  try {
    return await import(SHIKI_IMPORT_URL);
  } catch (error) {
    state.shikiUnavailable = true;
    console.warn("Shiki could not be loaded. Falling back to plain text rendering.", error);
    return null;
  }
}

function extractHighlightedLines(highlightedHtml) {
  const parser = new DOMParser();
  const document = parser.parseFromString(highlightedHtml, "text/html");
  const lineElements = document.querySelectorAll("code .line");

  if (lineElements.length > 0) {
    return [...lineElements].map((lineElement) => (lineElement.innerHTML.length > 0 ? lineElement.innerHTML : " "));
  }

  const codeElement = document.querySelector("code");
  if (!codeElement) {
    return [];
  }

  const fallbackLines = codeElement.innerHTML.split("\n");
  return fallbackLines.map((line) => (line.length > 0 ? line : " "));
}

function getShikiLanguageCandidates(filePath) {
  return getShikiLanguageCandidatesLogic(filePath);
}

function parseUnifiedPatch(patchText) {
  return parseUnifiedPatchLogic(patchText);
}

function countPatchLineTotals(patchText) {
  return countPatchLineTotalsLogic(patchText);
}

function markerForRowType(rowType) {
  return markerForRowTypeLogic(rowType);
}

function formatLineNumber(lineNumber) {
  return formatLineNumberLogic(lineNumber);
}

function getLineNumberColumnWidth(lineNumbers, minimumDigits) {
  return getLineNumberColumnWidthLogic(lineNumbers, minimumDigits);
}

function clampAnchorLine(anchorLine, maxLine) {
  return clampAnchorLineLogic(anchorLine, maxLine);
}

function getFilesSorted() {
  if (!state.bootstrap) {
    return [];
  }

  const sorted = [...state.bootstrap.files];
  sorted.sort((left, right) => compareFilesForSortMode(left.path, right.path));
  return sorted;
}

function isFileExpanded(filePath) {
  return state.expandedFilePaths.has(filePath);
}

function groupFilesByFolder(files) {
  return groupFilesByFolderLogic(files);
}

function folderForPath(filePath) {
  return folderForPathLogic(filePath);
}

function fileNameForPath(filePath) {
  return fileNameForPathLogic(filePath);
}

function getAllSymbolsForFile(filePath) {
  if (!state.bootstrap) {
    return [];
  }

  return [...state.bootstrap.symbols].filter(
    (symbol) => symbol.declaration.filePath === filePath && symbol.kind !== "file"
  );
}

function syncSymbolLineColumnWidth() {
  if (!symbolsListElement) {
    return;
  }

  const width = getLineNumberColumnWidth(
    state.bootstrap?.symbols
      ?.filter((symbol) => symbol.kind !== "file")
      .map((symbol) => symbol.declaration?.line) ?? [],
    1
  );
  symbolsListElement.style.setProperty("--symbol-line-column-width", `${width}ch`);
}

function getChangeKindForFile(file) {
  return getChangeKindForFileLogic(file);
}

function getChangeKindForSymbol(symbol) {
  const file = findFile(symbol.declaration.filePath);
  const patchRows = file ? getPatchRowsForFile(file.path) : [];
  return getChangeKindForSymbolPure(symbol, file, patchRows);
}

function getPatchRowsForFile(filePath) {
  const cached = state.patchRowsByFilePath.get(filePath);
  if (cached) {
    return cached;
  }

  const file = findFile(filePath);
  if (!file) {
    return [];
  }

  const patchRows = parseUnifiedPatch(file.patch);
  state.patchRowsByFilePath.set(filePath, patchRows);
  return patchRows;
}

function normalizeChangeKind(changeKind) {
  return normalizeChangeKindLogic(changeKind);
}

function getTargetSelectionForSymbol(symbol) {
  return getTargetSelectionForSymbolLogic(symbol);
}

function filterLocalSymbolsForTopLevel(localSymbols, topLevelSymbol, file, patchRows) {
  return filterLocalSymbolsForTopLevelLogic(localSymbols, topLevelSymbol, file, patchRows);
}

function getTopLevelSymbolsForFile(filePath) {
  return getAllSymbolsForFile(filePath)
    .filter((symbol) => symbol.scope === "top-level")
    .sort(compareSymbols);
}

function getLocalSymbolsForTopLevel(filePath, topLevelSymbolId) {
  if (!state.bootstrap) {
    return [];
  }

  return getAllSymbolsForFile(filePath)
    .filter((symbol) => symbol.scope === "local" && symbol.topLevelSymbolId === topLevelSymbolId)
    .sort(compareSymbols);
}

function compareSymbols(left, right) {
  return compareSymbolsLogic(left, right);
}

function initializeSortControl() {
  if (!symbolsSortElement) {
    return;
  }

  state.sortMode = normalizeSortMode(symbolsSortElement.value);
  symbolsSortElement.value = state.sortMode;
  symbolsSortElement.addEventListener("change", () => {
    const nextMode = normalizeSortMode(symbolsSortElement.value);
    if (nextMode === state.sortMode) {
      return;
    }

    state.sortMode = nextMode;
    renderSymbolList();
    if (nextMode === "usages") {
      void ensureUsageSortCountsLoaded();
    }
  });
}

function initializePaneResizers() {
  if (
    !layoutElement ||
    !paneSymbolsElement ||
    !paneCodeElement ||
    !paneUsagesElement ||
    !symbolsCodeResizerElement ||
    !codeUsagesResizerElement
  ) {
    return;
  }

  const storedPaneSizes = loadPaneSizes();
  applyPaneSizes(storedPaneSizes ?? PANE_DEFAULT_SIZE_BY_KEY);
  attachPaneResizer(symbolsCodeResizerElement, "symbols", "code");
  attachPaneResizer(codeUsagesResizerElement, "code", "usages");
}

function setUsagesPaneVisible(isVisible) {
  if (!layoutElement || !paneUsagesElement || !codeUsagesResizerElement) {
    return;
  }

  layoutElement.classList.toggle("layout-usages-hidden", !isVisible);
  paneUsagesElement.hidden = !isVisible;
  codeUsagesResizerElement.hidden = !isVisible;
}

function isUsagesPaneVisible() {
  return paneUsagesElement?.hidden !== true;
}

function attachPaneResizer(resizerElement, leftPaneKey, rightPaneKey) {
  resizerElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || isStackedLayout()) {
      return;
    }

    event.preventDefault();
    const startWidths = readPaneWidths();
    const startX = event.clientX;
    resizerElement.classList.add("dragging");
    document.body.classList.add("pane-resizing");

    const onPointerMove = (moveEvent) => {
      resizePanePairByDelta(startWidths, leftPaneKey, rightPaneKey, moveEvent.clientX - startX);
    };

    const onPointerUp = () => {
      cleanup();
      persistPaneSizesFromLayout();
    };

    const cleanup = () => {
      resizerElement.classList.remove("dragging");
      document.body.classList.remove("pane-resizing");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  });

  resizerElement.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    if (isStackedLayout()) {
      return;
    }

    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -PANE_RESIZE_STEP_PX : PANE_RESIZE_STEP_PX;
    resizePanePairByDelta(readPaneWidths(), leftPaneKey, rightPaneKey, delta);
    persistPaneSizesFromLayout();
  });
}

function resizePanePairByDelta(widths, leftPaneKey, rightPaneKey, deltaX) {
  if (!isUsagesPaneVisible() && leftPaneKey === "symbols" && rightPaneKey === "code") {
    resizeSymbolsAndCombinedPaneByDelta(widths, deltaX);
    return;
  }

  const leftWidth = widths[leftPaneKey];
  const rightWidth = widths[rightPaneKey];
  const pairWidth = leftWidth + rightWidth;
  if (pairWidth <= 0) {
    return;
  }

  const minLeft = PANE_MIN_WIDTH_BY_KEY[leftPaneKey];
  const minRight = PANE_MIN_WIDTH_BY_KEY[rightPaneKey];
  const maxLeft = pairWidth - minRight;
  const minLeftAllowed = minLeft;
  const nextLeft = maxLeft < minLeftAllowed
    ? clampNumber(leftWidth + deltaX, 0, pairWidth)
    : clampNumber(leftWidth + deltaX, minLeftAllowed, maxLeft);

  const nextWidths = {
    ...widths,
    [leftPaneKey]: nextLeft,
    [rightPaneKey]: pairWidth - nextLeft
  };
  applyPaneSizes(widthsToPaneSizes(nextWidths));
}

function resizeSymbolsAndCombinedPaneByDelta(widths, deltaX) {
  const symbolsWidth = widths.symbols;
  const combinedWidth = widths.code;
  const pairWidth = symbolsWidth + combinedWidth;
  if (pairWidth <= 0) {
    return;
  }

  const minSymbols = PANE_MIN_WIDTH_BY_KEY.symbols;
  const minCombined = PANE_MIN_WIDTH_BY_KEY.code;
  const maxSymbols = pairWidth - minCombined;
  const nextSymbolsWidth = maxSymbols < minSymbols
    ? clampNumber(symbolsWidth + deltaX, 0, pairWidth)
    : clampNumber(symbolsWidth + deltaX, minSymbols, maxSymbols);
  const nextCombinedSize = ((pairWidth - nextSymbolsWidth) / pairWidth) * 100;

  applyPaneSizes({
    symbols: (nextSymbolsWidth / pairWidth) * 100,
    ...splitCombinedPaneSize(nextCombinedSize)
  });
}

function readPaneWidths() {
  return {
    symbols: paneSymbolsElement?.getBoundingClientRect().width ?? 0,
    code: paneCodeElement?.getBoundingClientRect().width ?? 0,
    usages: paneUsagesElement?.getBoundingClientRect().width ?? 0
  };
}

function applyPaneSizes(sizes) {
  if (!layoutElement) {
    return;
  }

  const normalizedSizes = normalizePaneSizes(sizes);
  state.paneSizes = normalizedSizes;
  layoutElement.style.setProperty("--pane-symbols-size", normalizedSizes.symbols.toFixed(4));
  layoutElement.style.setProperty("--pane-code-size", normalizedSizes.code.toFixed(4));
  layoutElement.style.setProperty("--pane-usages-size", normalizedSizes.usages.toFixed(4));
}

function persistPaneSizesFromLayout() {
  savePaneSizes(readPaneSizesFromLayout());
}

function savePaneSizes(sizes) {
  try {
    localStorage.setItem(PANE_LAYOUT_STORAGE_KEY, JSON.stringify(normalizePaneSizes(sizes)));
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

function loadPaneSizes() {
  try {
    const raw = localStorage.getItem(PANE_LAYOUT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return normalizePaneSizes(parsed);
  } catch {
    return null;
  }
}

function normalizePaneSizes(sizes) {
  const symbols = Number(sizes?.symbols);
  const code = Number(sizes?.code);
  const usages = Number(sizes?.usages);
  const values = [symbols, code, usages];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    return { ...PANE_DEFAULT_SIZE_BY_KEY };
  }

  const total = symbols + code + usages;
  if (total <= 0) {
    return { ...PANE_DEFAULT_SIZE_BY_KEY };
  }

  return {
    symbols: (symbols / total) * 100,
    code: (code / total) * 100,
    usages: (usages / total) * 100
  };
}

function widthsToPaneSizes(widths) {
  const totalWidth = widths.symbols + widths.code + widths.usages;
  if (totalWidth <= 0) {
    return { ...PANE_DEFAULT_SIZE_BY_KEY };
  }

  return {
    symbols: (widths.symbols / totalWidth) * 100,
    code: (widths.code / totalWidth) * 100,
    usages: (widths.usages / totalWidth) * 100
  };
}

function readPaneSizesFromLayout() {
  const widths = readPaneWidths();
  if (isUsagesPaneVisible()) {
    return widthsToPaneSizes(widths);
  }

  const totalWidth = widths.symbols + widths.code;
  if (totalWidth <= 0) {
    return { ...state.paneSizes };
  }

  return {
    symbols: (widths.symbols / totalWidth) * 100,
    ...splitCombinedPaneSize((widths.code / totalWidth) * 100)
  };
}

function splitCombinedPaneSize(combinedSize) {
  const paneSizes = state.paneSizes ?? PANE_DEFAULT_SIZE_BY_KEY;
  const codeAndUsagesSize = paneSizes.code + paneSizes.usages;
  const defaultCombinedSize = PANE_DEFAULT_SIZE_BY_KEY.code + PANE_DEFAULT_SIZE_BY_KEY.usages;
  const codeRatio =
    codeAndUsagesSize > 0 ? paneSizes.code / codeAndUsagesSize : PANE_DEFAULT_SIZE_BY_KEY.code / defaultCombinedSize;
  const codeSize = combinedSize * codeRatio;
  return {
    code: codeSize,
    usages: combinedSize - codeSize
  };
}

function isStackedLayout() {
  return window.matchMedia("(max-width: 980px)").matches;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSortMode(mode) {
  return normalizeSortModeLogic(mode);
}

function compareFilesForSortMode(leftPath, rightPath) {
  return compareFilesForSortModeLogic(leftPath, rightPath, state.sortMode, getUsageDiffCountForFile);
}

function getUsageDiffCountForFile(filePath) {
  if (!state.bootstrap) {
    return Number.POSITIVE_INFINITY;
  }

  const symbolsInFile = state.bootstrap.symbols.filter(
    (symbol) => symbol.declaration.filePath === filePath && symbol.kind !== "file"
  );
  if (symbolsInFile.length === 0) {
    return 0;
  }

  let totalUsageCount = 0;
  for (const symbol of symbolsInFile) {
    totalUsageCount += getUsageDiffCountForSymbol(symbol.id);
  }
  return totalUsageCount;
}

function getUsageDiffCountForSymbol(symbolId) {
  const cached = state.usageInDiffCountBySymbolId.get(symbolId);
  if (cached !== undefined) {
    return cached;
  }

  const loaded = state.usagesBySymbolId.get(symbolId);
  if (loaded) {
    const count = countUsagesInDiff(loaded.usages);
    state.usageInDiffCountBySymbolId.set(symbolId, count);
    return count;
  }

  return Number.POSITIVE_INFINITY;
}

async function ensureUsageSortCountsLoaded() {
  if (!state.bootstrap || state.usageSortCountsLoading) {
    return;
  }

  const symbolsToLoad = state.bootstrap.symbols
    .filter((symbol) => symbol.kind !== "file")
    .filter((symbol) => !state.usageInDiffCountBySymbolId.has(symbol.id));
  if (symbolsToLoad.length === 0) {
    return;
  }

  state.usageSortCountsLoading = true;
  try {
    await Promise.all(symbolsToLoad.map((symbol) => loadUsageDiffCountForSymbol(symbol.id)));
  } finally {
    state.usageSortCountsLoading = false;
    if (state.sortMode === "usages") {
      renderSymbolList();
    }
  }
}

async function loadUsageDiffCountForSymbol(symbolId) {
  const cachedPayload = state.usagesBySymbolId.get(symbolId);
  if (cachedPayload) {
    state.usageInDiffCountBySymbolId.set(symbolId, countUsagesInDiff(cachedPayload.usages));
    return;
  }

  try {
    const payload = await fetchJson("/api/usages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ symbolId })
    });
    state.usagesBySymbolId.set(symbolId, payload);
    state.usageInDiffCountBySymbolId.set(symbolId, countUsagesInDiff(payload.usages));
  } catch {
    state.usageInDiffCountBySymbolId.set(symbolId, 0);
  }
}

function countUsagesInDiff(usages) {
  return countUsagesInDiffLogic(usages);
}

function countReferences(usages) {
  return countReferencesLogic(usages);
}
