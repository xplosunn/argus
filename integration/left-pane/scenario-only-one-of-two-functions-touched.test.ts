import { expect, it } from "vitest";

import { runLeftPaneScenario } from "./helpers";

it("left-pane scenario: only one of two functions touched", async () => {
  const leftPane = await runLeftPaneScenario([
    {
      path: "src/calc.ts",
      status: "modified",
      annotated: `
o export function first() {
o   const base = 1
-  return base
+  return base + 1
o }
o 
o export function second() {
o   return 2
o }
      `
    }
  ]);

  expect(leftPane).toMatchInlineSnapshot(`
    "folder src
      file [modified] src/calc.ts
        top [modified] L1 function first
          local [modified] L3 1 lines removed, 1 lines added"
  `);
});
