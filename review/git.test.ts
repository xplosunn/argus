import { describe, expect, it } from "vitest";

import { __internal as gitInternal } from "./git.ts";

describe("review/git internals", () => {
  it("parses name-status output with rename/copy normalization", () => {
    const output = [
      "M\tplain.ts",
      "R100\told/name.ts\tnew\\name.ts",
      "C88\tfrom.js\tto\\dest.js",
      "",
      "D\tdeleted.txt"
    ].join("\n");

    const changed = gitInternal.parseNameStatusOutput(output);
    expect(changed).toEqual([
      { path: "plain.ts", status: "modified" },
      { path: "new/name.ts", status: "renamed" },
      { path: "to/dest.js", status: "copied" },
      { path: "deleted.txt", status: "deleted" }
    ]);
  });

  it("parses changed line ranges from hunk headers", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "@@ -1,0 +10,2 @@",
      "+a",
      "+b",
      "@@ -7 +20 @@",
      " context",
      "@@ -2,3 +0,0 @@",
      "-gone"
    ].join("\n");

    const ranges = gitInternal.parseChangedLineRanges(diff);
    expect(ranges).toEqual([
      { startLine: 10, endLine: 11 },
      { startLine: 20, endLine: 20 }
    ]);
  });

  it("builds new-file patch with trailing newline content", () => {
    const patch = gitInternal.buildNewFilePatch("folder\\file.css", "a\nb\n");

    expect(patch).toMatch(/^diff --git a\/folder\/file\.css b\/folder\/file\.css/m);
    expect(patch).toMatch(/^new file mode 100644$/m);
    expect(patch).toMatch(/^@@ -0,0 \+1,2 @@$/m);
    expect(patch).toMatch(/^\+a$/m);
    expect(patch).toMatch(/^\+b$/m);
    expect(patch.includes("\\ No newline at end of file")).toBe(false);
  });

  it("marks missing trailing newline in new-file patch", () => {
    const patch = gitInternal.buildNewFilePatch("file.ts", "const a = 1;");
    expect(patch).toMatch(/^@@ -0,0 \+1,1 @@$/m);
    expect(patch).toMatch(/^\+const a = 1;$/m);
    expect(patch).toMatch(/^\\ No newline at end of file$/m);
  });

  it("normalizes refs and path separators", () => {
    expect(gitInternal.normalizeBranchRef("refs/remotes/origin/main")).toBe("main");
    expect(gitInternal.normalizeBranchRef("refs/heads/feature/x")).toBe("feature/x");
    expect(gitInternal.normalizePath("a\\b\\c.ts")).toBe("a/b/c.ts");
  });
});
