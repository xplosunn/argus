import { expect, it } from "vitest";

import { runLeftPaneScenario } from "./helpers";

it("left-pane scenario: hides synthetic line counts under added top-level symbols", () => {
  const leftPane = runLeftPaneScenario([
    {
      path: "src/calc.test.ts",
      status: "modified",
      annotated: `
o import { expect, test } from "vitest"
o 
+ test("adds numbers", () => {
+   expect(1 + 1).toBe(2)
+ })
      `
    }
  ]);

  expect(leftPane).toMatchInlineSnapshot(`
    "folder src
      file [modified] src/calc.test.ts
        top [added] L3 test adds numbers"
  `);
});
