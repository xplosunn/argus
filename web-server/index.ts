import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import type { UsagesRequest } from "../protocol";
import type { ReviewSession } from "../review";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

export interface StartWebServerOptions {
  clientRoot: string;
  session: ReviewSession;
  port: number;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

export async function startWebServer(options: StartWebServerOptions): Promise<RunningServer> {
  const clientRoot = path.resolve(options.clientRoot);

  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      sendStatus(response, 400);
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");
    const method = request.method ?? "GET";

    if (method === "GET" && url.pathname === "/api/bootstrap") {
      sendJson(response, 200, options.session.bootstrap);
      return;
    }

    if (method === "GET" && url.pathname === "/api/file") {
      const filePath = url.searchParams.get("path");
      if (typeof filePath !== "string" || filePath.length === 0) {
        sendJson(response, 400, { error: "path is required." });
        return;
      }

      const result = options.session.getFileContent(filePath);
      if (!result) {
        sendJson(response, 404, { error: "File not found." });
        return;
      }

      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && url.pathname === "/api/usages") {
      const rawBody = await readBody(request);
      let payload: UsagesRequest;
      try {
        payload = JSON.parse(rawBody || "{}") as UsagesRequest;
      } catch {
        sendJson(response, 400, { error: "Invalid JSON body." });
        return;
      }

      if (typeof payload.symbolId !== "string" || payload.symbolId.length === 0) {
        sendJson(response, 400, { error: "symbolId is required." });
        return;
      }

      const result = options.session.getUsages(payload.symbolId);
      if (!result) {
        sendJson(response, 404, { error: "Symbol not found." });
        return;
      }

      sendJson(response, 200, result);
      return;
    }

    if (method !== "GET") {
      sendStatus(response, 405);
      return;
    }

    let requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
    requestedPath = requestedPath.replaceAll("\\", "/");
    const absolutePath = path.resolve(clientRoot, `.${requestedPath}`);
    if (!absolutePath.startsWith(clientRoot)) {
      sendStatus(response, 403);
      return;
    }

    try {
      const fileBuffer = await fs.readFile(absolutePath);
      const extension = path.extname(absolutePath);
      const contentType = MIME_TYPES[extension] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": contentType });
      response.end(fileBuffer);
    } catch {
      sendStatus(response, 404);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine server address.");
  }

  return {
    port: address.port,
    close(): Promise<void> {
      return new Promise((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    }
  };
}

function sendStatus(response: http.ServerResponse, status: number): void {
  response.writeHead(status);
  response.end();
}

function sendJson(response: http.ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}
