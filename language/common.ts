import path from "node:path";

import type { LineRange } from "../protocol";

export function lineInRanges(line: number, ranges: readonly LineRange[]): boolean {
  for (const range of ranges) {
    if (line >= range.startLine && line <= range.endLine) {
      return true;
    }
  }
  return false;
}

export function intersectsRanges(startLine: number, endLine: number, ranges: readonly LineRange[]): boolean {
  for (const range of ranges) {
    if (endLine >= range.startLine && startLine <= range.endLine) {
      return true;
    }
  }
  return false;
}

export function encodeSymbolId(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function toRepoPath(repoRoot: string, absolutePath: string): string {
  return normalizePath(path.relative(repoRoot, absolutePath));
}

export function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}
