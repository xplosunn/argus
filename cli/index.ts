#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { parseArgs } from "./args";
import { createReviewSession } from "../review";
import { startWebServer } from "../web-server";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.showHelp) {
    printUsage();
    return;
  }

  if (options.command !== "review") {
    if (options.command) {
      console.error(`Unknown command: ${options.command}`);
    }
    printUsage();
    process.exitCode = 1;
    return;
  }

  const invocationCwd = process.env.INIT_CWD ?? process.env.PWD ?? process.cwd();
  const requestedRepoPath = options.repoPath
    ? path.resolve(invocationCwd, options.repoPath)
    : path.resolve(invocationCwd);
  const repoRoot = resolveGitRepositoryRoot(requestedRepoPath);
  const clientRoot = resolveClientRoot();
  const session = createReviewSession({
    repoRoot,
    defaultBranch: options.defaultBranch
  });

  const server = await startWebServer({
    clientRoot,
    session,
    port: options.port
  });
  const reviewUrl = `http://127.0.0.1:${server.port}`;
  const comparison =
    session.bootstrap.review.mode === "working-tree"
      ? "HEAD...WORKTREE (uncommitted changes)"
      : `${session.bootstrap.review.defaultBranch}...HEAD (${session.bootstrap.review.baseSha})`;

  console.log(`Argus review running at ${reviewUrl}`);
  console.log(`Repository: ${repoRoot}`);
  console.log(`Comparison: ${comparison}`);
  console.log(`Changed files: ${session.bootstrap.files.length}, touched symbols: ${session.bootstrap.symbols.length}`);
  openInBrowser(reviewUrl);

  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}

function printUsage(): void {
  console.log("Argus");
  console.log("");
  console.log("Usage:");
  console.log("  argus review [--repo <path>] [--port <number>] [--default-branch <ref>]");
  console.log("  argus help");
}

void main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("Unexpected error.");
  }
  process.exit(1);
});

function openInBrowser(url: string): void {
  const platform = process.platform;

  if (platform === "darwin") {
    spawnDetached("open", [url]);
    return;
  }

  if (platform === "win32") {
    spawnDetached("cmd", ["/c", "start", "", url], { windowsHide: true });
    return;
  }

  spawnDetached("xdg-open", [url]);
}

function spawnDetached(command: string, args: string[], extraOptions?: { windowsHide?: boolean }): void {
  const child = spawn(command, args, {
    stdio: "ignore",
    detached: true,
    ...extraOptions
  });
  child.on("error", () => {
    console.warn(`Unable to open browser automatically. Open this URL manually: ${args[args.length - 1]}`);
  });
  child.unref();
}

function resolveGitRepositoryRoot(startPath: string): string {
  try {
    const root = execFileSync("git", ["-C", startPath, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trimEnd();

    if (!root) {
      throw new Error("Unable to determine repository root.");
    }
    return root;
  } catch {
    throw new Error(`No git repository found at or above: ${startPath}`);
  }
}

function resolveClientRoot(): string {
  const candidates = [
    path.resolve(__dirname, "..", "web-client"),
    path.resolve(__dirname, "..", "..", "web-client")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  throw new Error("Unable to locate web-client assets.");
}
