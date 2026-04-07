import { expect, it } from "vitest";

import { runLeftPaneScenario } from "./helpers";

it("left-pane scenario: detects top-level test symbols without describe", () => {
  const leftPane = runLeftPaneScenario([
    {
      path: "src/calc.test.ts",
      status: "modified",
      annotated: `
o import { expect, test } from "vitest"
o 
o test("adds numbers", () => {
o   expect(1 + 1).toBe(2)
+  expect(2 + 2).toBe(4)
o })
      `
    }
  ]);

  expect(leftPane).toMatchInlineSnapshot(`
    "folder src
      file [modified] src/calc.test.ts
        top [modified] L3 test adds numbers
          local [added] L5 1 lines added"
  `);
});
