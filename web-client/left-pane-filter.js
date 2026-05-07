const filterInput = document.getElementById("symbols-filter");
const symbolsList = document.getElementById("symbols-list");

if (filterInput instanceof HTMLInputElement && symbolsList instanceof HTMLElement) {
  filterInput.addEventListener("input", () => {
    applyLeftPaneFilter(filterInput.value);
  });

  const observer = new MutationObserver(() => {
    applyLeftPaneFilter(filterInput.value);
  });
  observer.observe(symbolsList, { childList: true, subtree: true });
}

function applyLeftPaneFilter(rawQuery) {
  if (!(symbolsList instanceof HTMLElement)) {
    return;
  }

  const query = normalizeText(rawQuery);
  const isFiltering = query.length > 0;
  let visibleFileCount = 0;

  for (const reviewMapItem of symbolsList.querySelectorAll(".review-map-item")) {
    reviewMapItem.hidden = false;
  }

  for (const folderGroup of symbolsList.querySelectorAll(".folder-group")) {
    let folderHasMatch = false;
    let currentFileBlock = null;

    for (const child of folderGroup.children) {
      if (!(child instanceof HTMLElement)) {
        continue;
      }

      if (child.classList.contains("folder-header")) {
        continue;
      }

      if (child.classList.contains("file-item")) {
        if (currentFileBlock) {
          const blockMatches = finishFileBlock(currentFileBlock, query);
          folderHasMatch = folderHasMatch || blockMatches;
          if (blockMatches) {
            visibleFileCount += 1;
          }
        }
        currentFileBlock = {
          fileItem: child,
          symbolRows: []
        };
        continue;
      }

      if (child.classList.contains("symbol-row") && currentFileBlock) {
        currentFileBlock.symbolRows.push(child);
      }
    }

    if (currentFileBlock) {
      const blockMatches = finishFileBlock(currentFileBlock, query);
      folderHasMatch = folderHasMatch || blockMatches;
      if (blockMatches) {
        visibleFileCount += 1;
      }
    }

    folderGroup.hidden = isFiltering && !folderHasMatch;
    const folderHeader = folderGroup.querySelector(":scope > .folder-header");
    if (folderHeader instanceof HTMLElement) {
      folderHeader.hidden = isFiltering && !folderHasMatch;
    }
  }

  renderFilterEmptyState(isFiltering && visibleFileCount === 0);
}

function finishFileBlock(fileBlock, query) {
  const isFiltering = query.length > 0;
  const fileText = normalizeText(fileBlock.fileItem.textContent ?? "");
  const fileMatches = isFiltering && fileText.includes(query);
  let hasMatchingSymbol = false;

  for (const symbolRow of fileBlock.symbolRows) {
    const symbolMatches = isFiltering && normalizeText(symbolRow.textContent ?? "").includes(query);
    const shouldShowSymbol = !isFiltering || fileMatches || symbolMatches;
    symbolRow.hidden = !shouldShowSymbol;
    hasMatchingSymbol = hasMatchingSymbol || symbolMatches;
  }

  const shouldShowFile = !isFiltering || fileMatches || hasMatchingSymbol;
  fileBlock.fileItem.hidden = !shouldShowFile;
  return shouldShowFile;
}

function renderFilterEmptyState(shouldShow) {
  let empty = symbolsList.querySelector(".filter-empty");

  if (!shouldShow) {
    empty?.remove();
    return;
  }

  if (!(empty instanceof HTMLElement)) {
    empty = document.createElement("div");
    empty.className = "empty filter-empty";
    empty.textContent = "No files or symbols match the filter.";
    symbolsList.appendChild(empty);
  }
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}
