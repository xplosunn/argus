import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import type { BootstrapResponse, StaticReviewBundle } from "../protocol";
import { createStaticReviewBundle } from "../review";

interface DemoGeneratorOptions {
  repoPath: string;
  outputPath: string;
  title?: string;
  defaultBranch?: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(process.cwd(), options.repoPath);
  const outputRoot = path.resolve(process.cwd(), options.outputPath);
  const webClientRoot = await resolveWebClientRoot();
  const repoName = detectRepoName(repoRoot);
  const bundle = sanitizeBundle(
    createStaticReviewBundle({
      repoRoot,
      defaultBranch: options.defaultBranch
    }),
    repoName
  );

  await writeStaticDemo({
    outputRoot,
    webClientRoot,
    bundle,
    title: options.title ?? `${repoName} review`
  });

  console.log(`Static demo written to ${outputRoot}`);
}

function detectRepoName(repoRoot: string): string {
  const remoteUrl = getOriginRemoteUrl(repoRoot);
  if (!remoteUrl) {
    return path.basename(repoRoot);
  }

  const normalized = remoteUrl.trim().replace(/\.git$/, "");
  const match = normalized.match(/[:/]([^/:]+\/[^/]+)$/);
  return match?.[1] ?? path.basename(repoRoot);
}

function getOriginRemoteUrl(repoRoot: string): string | null {
  try {
    return execFileSync("git", ["-C", repoRoot, "config", "--get", "remote.origin.url"], {
      encoding: "utf8"
    }).trim();
  } catch {
    return null;
  }
}

function sanitizeBundle(bundle: StaticReviewBundle, repoName: string): StaticReviewBundle {
  return {
    bootstrap: sanitizeBootstrap(bundle.bootstrap, repoName),
    fileContentsByPath: bundle.fileContentsByPath,
    usagesBySymbolId: bundle.usagesBySymbolId,
    dependencyGraph: bundle.dependencyGraph
  };
}

function sanitizeBootstrap(bootstrap: BootstrapResponse, repoName: string): BootstrapResponse {
  return {
    ...bootstrap,
    review: {
      ...bootstrap.review,
      repoRoot: repoName
    }
  };
}

function parseArgs(args: string[]): DemoGeneratorOptions {
  const options: DemoGeneratorOptions = {
    repoPath: "",
    outputPath: "landing-page/review-demo/public-pr",
    title: undefined,
    defaultBranch: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "--") {
      continue;
    }

    if (token === "--repo") {
      options.repoPath = requireValue(token, args[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--output") {
      options.outputPath = requireValue(token, args[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--title") {
      options.title = requireValue(token, args[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--default-branch") {
      options.defaultBranch = requireValue(token, args[index + 1]);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  if (!options.repoPath) {
    throw new Error("--repo is required.");
  }

  return options;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

async function resolveWebClientRoot(): Promise<string> {
  const candidates = [
    path.resolve(__dirname, "..", "web-client"),
    path.resolve(__dirname, "..", "..", "web-client")
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, "index.html"));
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error("Unable to locate web-client assets.");
}

async function writeStaticDemo(options: {
  outputRoot: string;
  webClientRoot: string;
  bundle: StaticReviewBundle;
  title: string;
}): Promise<void> {
  await fs.rm(options.outputRoot, { recursive: true, force: true });
  const dataRoot = path.join(options.outputRoot, "data");
  await fs.mkdir(options.outputRoot, { recursive: true });
  await fs.mkdir(dataRoot, { recursive: true });

  const templateHtml = await fs.readFile(path.join(options.webClientRoot, "index.html"), "utf8");
  const appJs = await fs.readFile(path.join(options.webClientRoot, "app.js"), "utf8");
  const logicJs = await fs.readFile(path.join(options.webClientRoot, "logic.js"), "utf8");
  const stylesCss = await fs.readFile(path.join(options.webClientRoot, "styles.css"), "utf8");

  await fs.writeFile(
    path.join(options.outputRoot, "index.html"),
    buildStaticDemoHtml(templateHtml, {
      title: options.title
    })
  );
  await fs.writeFile(path.join(options.outputRoot, "mock-api.js"), buildMockApiScript());
  await fs.writeFile(path.join(options.outputRoot, "app.js"), appJs);
  await fs.writeFile(path.join(options.outputRoot, "logic.js"), logicJs);
  await fs.writeFile(path.join(options.outputRoot, "styles.css"), stylesCss);
  await fs.writeFile(path.join(dataRoot, "bootstrap.json"), `${JSON.stringify(options.bundle.bootstrap, null, 2)}\n`);
  await fs.writeFile(path.join(dataRoot, "file-contents.json"), `${JSON.stringify(options.bundle.fileContentsByPath, null, 2)}\n`);
  await fs.writeFile(path.join(dataRoot, "usages.json"), `${JSON.stringify(options.bundle.usagesBySymbolId, null, 2)}\n`);
  await fs.writeFile(path.join(dataRoot, "dependency-graph.json"), `${JSON.stringify(options.bundle.dependencyGraph, null, 2)}\n`);
}

function buildStaticDemoHtml(
  templateHtml: string,
  options: {
    title: string;
  }
): string {
  return templateHtml
    .replace("<title>Argus Review</title>", `<title>${escapeHtml(options.title)} · Argus</title>`)
    .replace(
      '<script type="module" src="./app.js"></script>',
      '    <script src="./mock-api.js"></script>\n    <script type="module" src="./app.js"></script>'
    );
}

function buildMockApiScript(): string {
  return [
    "(() => {",
    "  const originalFetch = window.fetch.bind(window);",
    "  const bootstrapUrl = new URL(\"./data/bootstrap.json\", window.location.href).toString();",
    "  const fileContentsUrl = new URL(\"./data/file-contents.json\", window.location.href).toString();",
    "  const usagesUrl = new URL(\"./data/usages.json\", window.location.href).toString();",
    "  const dependencyGraphUrl = new URL(\"./data/dependency-graph.json\", window.location.href).toString();",
    "  let bootstrapPromise = null;",
    "  let fileContentsPromise = null;",
    "  let usagesPromise = null;",
    "",
    "  window.fetch = async (input, init) => {",
    "    const requestUrl = resolveRequestUrl(input);",
    "    if (!requestUrl) {",
    "      return originalFetch(input, init);",
    "    }",
    "",
    "    if (requestUrl.pathname === \"/api/bootstrap\") {",
    "      return originalFetch(bootstrapUrl);",
    "    }",
    "",
    "    if (requestUrl.pathname === \"/api/file\") {",
    "      const filePath = requestUrl.searchParams.get(\"path\");",
    "      if (!filePath) {",
    "        return jsonResponse(400, { error: \"path is required.\" });",
    "      }",
    "      const fileContentsByPath = await loadFileContentsByPath();",
    "      if (!(filePath in fileContentsByPath)) {",
    "        return jsonResponse(404, { error: \"File not found.\" });",
    "      }",
    "      return jsonResponse(200, { filePath, content: fileContentsByPath[filePath] });",
    "    }",
    "",
    "    if (requestUrl.pathname === \"/api/dependency-graph\") {",
    "      return originalFetch(dependencyGraphUrl);",
    "    }",
    "",
    "    if (requestUrl.pathname === \"/api/usages\") {",
    "      const requestBody = await readJsonBody(input, init);",
    "      usagesPromise ??= originalFetch(usagesUrl).then(assertOk).then((response) => response.json());",
    "      const usagesBySymbolId = await usagesPromise;",
    "      const payload = usagesBySymbolId?.[requestBody.symbolId];",
    "      if (!payload) {",
    "        return jsonResponse(404, { error: \"Symbol not found.\" });",
    "      }",
    "      return jsonResponse(200, payload);",
    "    }",
    "",
    "    return originalFetch(input, init);",
    "  };",
    "",
    "  function resolveRequestUrl(input) {",
    "    if (typeof input === \"string\" || input instanceof URL) {",
    "      return new URL(String(input), window.location.href);",
    "    }",
    "",
    "    if (input instanceof Request) {",
    "      return new URL(input.url, window.location.href);",
    "    }",
    "",
    "    return null;",
    "  }",
    "",
    "  async function readJsonBody(input, init) {",
    "    if (typeof init?.body === \"string\" && init.body.length > 0) {",
    "      return JSON.parse(init.body);",
    "    }",
    "",
    "    if (input instanceof Request) {",
    "      const text = await input.clone().text();",
    "      return text.length > 0 ? JSON.parse(text) : {};",
    "    }",
    "",
    "    return {};",
    "  }",
    "",
    "  async function loadBootstrap() {",
    "    bootstrapPromise ??= originalFetch(bootstrapUrl).then(assertOk).then((response) => response.json());",
    "    return bootstrapPromise;",
    "  }",
    "",
    "  async function loadFileContentsByPath() {",
    "    if (!fileContentsPromise) {",
    "      fileContentsPromise = originalFetch(fileContentsUrl)",
    "        .then((response) => {",
    "          if (!response.ok) {",
    "            return null;",
    "          }",
    "          return response.json();",
    "        })",
    "        .then(async (fileContentsByPath) => {",
    "          if (fileContentsByPath) {",
    "            return fileContentsByPath;",
    "          }",
    "          const bootstrap = await loadBootstrap();",
    "          const fallback = {};",
    "          for (const file of bootstrap.files ?? []) {",
    "            fallback[file.path] = file.content ?? null;",
    "          }",
    "          return fallback;",
    "        });",
    "    }",
    "    return fileContentsPromise;",
    "  }",
    "",
    "  function assertOk(response) {",
    "    if (!response.ok) {",
    "      throw new Error(`Request failed: ${response.status}`);",
    "    }",
    "    return response;",
    "  }",
    "",
    "  function jsonResponse(status, payload) {",
    "    return new Response(JSON.stringify(payload), {",
    "      status,",
    "      headers: {",
    "        \"Content-Type\": \"application/json; charset=utf-8\"",
    "      }",
    "    });",
    "  }",
    "})();",
    ""
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

void main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("Unexpected error.");
  }
  process.exit(1);
});
