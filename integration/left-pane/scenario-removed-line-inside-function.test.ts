import { expect, it } from "vitest";

import { runLeftPaneScenario } from "./helpers";

it("left-pane scenario: removed line inside function", () => {
  const leftPane = runLeftPaneScenario([
    {
      path: "src/calc.ts",
      status: "modified",
      annotated: `
o export function run() {
o   const base = 1
-  const value = base + 1
+  return base + 2
o }
      `
    }
  ]);

  expect(leftPane).toMatchInlineSnapshot(`
    "folder src
      file [modified] src/calc.ts
        top [modified] L1 function run
          local [modified] L3 1 lines removed, 1 lines added"
  `);
});
