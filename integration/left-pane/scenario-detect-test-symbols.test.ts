import { expect, it } from "vitest";

import { runLeftPaneScenario } from "./helpers";

it("left-pane scenario: detects describe/it calls as test symbols", async () => {
  const leftPane = await runLeftPaneScenario([
    {
      path: "src/calc.test.ts",
      status: "modified",
      annotated: `
o import { describe, expect, it } from "vitest"
o 
o describe("sum", () => {
o   it("adds numbers", () => {
-    expect(1 + 1).toBe(3)
+    expect(1 + 1).toBe(2)
o   })
o })
      `
    }
  ]);

  expect(leftPane).toMatchInlineSnapshot(`
    "folder src
      file [modified] src/calc.test.ts
        top [modified] L3 test sum
          local [modified] L4 test adds numbers"
  `);
});
