import { describe, expect, it } from "vitest";

import { parseArgs } from "./args.ts";

describe("parseArgs", () => {
  it("defaults to help when no args", () => {
    expect(parseArgs([])).toEqual({
      command: undefined,
      port: 0,
      defaultBranch: undefined,
      showHelp: true
    });
  });

  it("parses review options", () => {
    expect(parseArgs(["review", "--port", "3001", "--default-branch", "origin/main", "--repo", "../x"])).toEqual({
      command: "review",
      port: 3001,
      defaultBranch: "origin/main",
      repoPath: "../x",
      showHelp: false
    });
  });

  it("handles inline help flags and validates values", () => {
    expect(parseArgs(["review", "-h"]).showHelp).toBe(true);
    expect(() => parseArgs(["review", "--port"])).toThrow(/--port requires a value\./);
    expect(() => parseArgs(["review", "--port", "nope"])).toThrow(/Invalid --port value: nope/);
    expect(() => parseArgs(["review", "--default-branch"])).toThrow(/--default-branch requires a value\./);
    expect(() => parseArgs(["review", "--repo"])).toThrow(/--repo requires a value\./);
  });
});
