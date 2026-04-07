import { expect, it } from "vitest";

import { runLeftPaneScenario } from "./helpers";

it("left-pane scenario: change between two functions", () => {
  const leftPane = runLeftPaneScenario([
    {
      path: "src/calc.ts",
      status: "modified",
      annotated: `
o export function first() {
o   return 1
o }
- 
+ console.log("changed")
o export function second() {
o   return 2
o }
      `
    }
  ]);

  expect(leftPane).toMatchInlineSnapshot(`
    "folder src
      file [modified] src/calc.ts
        top [modified] L4 1 lines removed, 1 lines added"
  `);
});
