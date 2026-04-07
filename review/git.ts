import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { ChangeStatus, LineRange } from "../protocol";

export interface ChangedFileMeta {
  path: string;
  status: ChangeStatus;
}

function runGit(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trimEnd();
}

function tryGit(repoRoot: string, args: string[]): string | null {
  try {
    return runGit(repoRoot, args);
  } catch {
    return null;
  }
}

export function detectDefaultBranch(repoRoot: string): string {
  const remoteHead = tryGit(repoRoot, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  if (remoteHead && remoteHead.startsWith("refs/remotes/")) {
    return remoteHead.slice("refs/remotes/".length);
  }

  const candidates = ["origin/main", "main", "origin/master", "master"];
  for (const candidate of candidates) {
    const exists = tryGit(repoRoot, ["rev-parse", "--verify", "--quiet", candidate]);
    if (exists !== null) {
      return candidate;
    }
  }

  const currentBranch = tryGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (currentBranch && currentBranch !== "HEAD") {
    return currentBranch;
  }

  return "HEAD";
}

export function getCurrentBranch(repoRoot: string): string {
  const branch = tryGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch ?? "HEAD";
}

export function areEquivalentBranchRefs(leftRef: string, rightRef: string): boolean {
  return normalizeBranchRef(leftRef) === normalizeBranchRef(rightRef);
}

export function getMergeBase(repoRoot: string, defaultBranch: string): string {
  return runGit(repoRoot, ["merge-base", "HEAD", defaultBranch]);
}

export function getHeadSha(repoRoot: string): string {
  return runGit(repoRoot, ["rev-parse", "HEAD"]);
}

export function listTrackedFiles(repoRoot: string): string[] {
  const output = runGit(repoRoot, ["ls-files"]);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function getChangedFiles(repoRoot: string, baseSha: string): ChangedFileMeta[] {
  const output = runGit(repoRoot, [
    "diff",
    "--name-status",
    "--find-renames",
    "--diff-filter=ACDMRTUXB",
    `${baseSha}..HEAD`
  ]);

  return parseNameStatusOutput(output);
}

export function getUncommittedChangedFiles(repoRoot: string): ChangedFileMeta[] {
  const trackedOutput = runGit(repoRoot, [
    "diff",
    "--name-status",
    "--find-renames",
    "--diff-filter=ACDMRTUXB",
    "HEAD"
  ]);
  const changed = parseNameStatusOutput(trackedOutput);
  const seen = new Set(changed.map((entry) => entry.path));

  const untrackedOutput = runGit(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
  for (const filePath of untrackedOutput.split("\n")) {
    const trimmedPath = filePath.trim();
    if (!trimmedPath) {
      continue;
    }

    const normalizedPath = normalizePath(trimmedPath);
    if (seen.has(normalizedPath)) {
      continue;
    }

    changed.push({
      path: normalizedPath,
      status: "added"
    });
    seen.add(normalizedPath);
  }

  return changed;
}

export function getChangedLineRanges(repoRoot: string, baseSha: string, filePath: string): LineRange[] {
  const output = tryGit(repoRoot, ["diff", "--unified=0", "--no-color", `${baseSha}..HEAD`, "--", filePath]);
  return parseChangedLineRanges(output);
}

export function getChangedLineRangesAgainstHead(
  repoRoot: string,
  filePath: string,
  status: ChangeStatus
): LineRange[] {
  const output = tryGit(repoRoot, ["diff", "--unified=0", "--no-color", "HEAD", "--", filePath]);
  const parsedRanges = parseChangedLineRanges(output);
  if (parsedRanges.length > 0) {
    return parsedRanges;
  }

  if (status === "added") {
    const lineCount = countWorkingTreeLines(repoRoot, filePath);
    if (lineCount > 0) {
      return [
        {
          startLine: 1,
          endLine: lineCount
        }
      ];
    }
  }

  return [];
}

export function getFileContentAtHead(repoRoot: string, filePath: string): string | null {
  return tryGit(repoRoot, ["show", `HEAD:${filePath}`]);
}

export function getFileContentInWorkingTree(repoRoot: string, filePath: string): string | null {
  const absolutePath = path.resolve(repoRoot, filePath);
  try {
    return fs.readFileSync(absolutePath, "utf8");
  } catch {
    return null;
  }
}

export function getFilePatch(repoRoot: string, baseSha: string, filePath: string): string | null {
  return tryGit(repoRoot, ["diff", "--no-color", `${baseSha}..HEAD`, "--", filePath]);
}

export function getFilePatchAgainstHead(repoRoot: string, filePath: string, status: ChangeStatus): string | null {
  const patch = tryGit(repoRoot, ["diff", "--no-color", "HEAD", "--", filePath]);
  if (patch && patch.trim() !== "") {
    return patch;
  }

  if (status === "added") {
    const content = getFileContentInWorkingTree(repoRoot, filePath);
    if (content === null) {
      return null;
    }

    return buildNewFilePatch(filePath, content);
  }

  return patch;
}

function parseNameStatusOutput(output: string): ChangedFileMeta[] {
  const changed: ChangedFileMeta[] = [];

  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    const parts = line.split("\t");
    const statusToken = parts[0] ?? "M";
    const gitStatus = statusToken[0];

    let filePath = parts[1] ?? "";
    if ((gitStatus === "R" || gitStatus === "C") && parts.length >= 3) {
      filePath = parts[2] ?? filePath;
    }

    if (!filePath) {
      continue;
    }

    changed.push({
      path: normalizePath(filePath),
      status: mapGitStatus(gitStatus)
    });
  }

  return changed;
}

function mapGitStatus(gitStatus: string | undefined): ChangeStatus {
  if (gitStatus === "A") {
    return "added";
  }
  if (gitStatus === "D") {
    return "deleted";
  }
  if (gitStatus === "R") {
    return "renamed";
  }
  if (gitStatus === "C") {
    return "copied";
  }
  return "modified";
}

function parseChangedLineRanges(output: string | null): LineRange[] {
  if (output === null || output.trim() === "") {
    return [];
  }

  const ranges: LineRange[] = [];
  const hunkHeaderRegex = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

  for (const line of output.split("\n")) {
    const match = line.match(hunkHeaderRegex);
    if (!match) {
      continue;
    }

    const startLine = Number.parseInt(match[1] ?? "0", 10);
    const countToken = match[2];
    const lineCount = countToken === undefined ? 1 : Number.parseInt(countToken, 10);

    if (lineCount <= 0 || startLine <= 0) {
      continue;
    }

    ranges.push({
      startLine,
      endLine: startLine + lineCount - 1
    });
  }

  return ranges;
}

function countWorkingTreeLines(repoRoot: string, filePath: string): number {
  const content = getFileContentInWorkingTree(repoRoot, filePath);
  if (content === null || content.length === 0) {
    return 0;
  }

  const lines = content.split(/\r?\n/);
  if (content.endsWith("\n") || content.endsWith("\r\n")) {
    return lines.length - 1;
  }
  return lines.length;
}

function buildNewFilePatch(filePath: string, content: string): string {
  const normalizedPath = normalizePath(filePath);
  const hasTrailingNewline = content.endsWith("\n") || content.endsWith("\r\n");
  const lines = content.length === 0 ? [] : content.split(/\r?\n/);
  if (hasTrailingNewline && lines.length > 0) {
    lines.pop();
  }

  let patch = "";
  patch += `diff --git a/${normalizedPath} b/${normalizedPath}\n`;
  patch += "new file mode 100644\n";
  patch += "--- /dev/null\n";
  patch += `+++ b/${normalizedPath}\n`;

  if (lines.length === 0) {
    return patch.trimEnd();
  }

  patch += `@@ -0,0 +1,${lines.length} @@\n`;
  for (const line of lines) {
    patch += `+${line}\n`;
  }

  if (!hasTrailingNewline) {
    patch += "\\ No newline at end of file\n";
  }

  return patch.trimEnd();
}

function normalizeBranchRef(branchRef: string): string {
  let normalized = branchRef.trim();
  normalized = normalized.replace(/^refs\/heads\//, "");
  normalized = normalized.replace(/^refs\/remotes\//, "");
  normalized = normalized.replace(/^origin\//, "");
  return normalized;
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

export const __internal = {
  mapGitStatus,
  parseNameStatusOutput,
  parseChangedLineRanges,
  buildNewFilePatch,
  normalizeBranchRef,
  normalizePath
};
