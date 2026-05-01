import { expect, it } from "vitest";

import { runLeftPaneScenario } from "./helpers";

it("left-pane scenario: added line inside function", async () => {
  const leftPane = await runLeftPaneScenario([
    {
      path: "src/calc.ts",
      status: "modified",
      annotated: `
o export function run() {
o   const base = 1
+  const extra = base + 1
o   return extra
o }
      `
    }
  ]);

  expect(leftPane).toMatchInlineSnapshot(`
    "folder src
      file [modified] src/calc.ts
        top [modified] L1 function run
          local [added] L3 variable extra"
  `);
});
