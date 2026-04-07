import { expect, it } from "vitest";

import { runLeftPaneScenario } from "./helpers";

it("left-pane scenario: local changed but declaration line untouched", () => {
  const leftPane = runLeftPaneScenario([
    {
      path: "src/calc.ts",
      status: "modified",
      annotated: `
o export function run() {
o   function helper(value: number) {
-    return value + 1
+    return value + 2
o   }
o   return helper(1)
o }
      `
    }
  ]);

  expect(leftPane).toMatchInlineSnapshot(`
    "folder src
      file [modified] src/calc.ts
        top [modified] L1 function run
          local [modified] L2 function helper"
  `);
});
