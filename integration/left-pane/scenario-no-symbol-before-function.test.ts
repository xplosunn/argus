import { expect, it } from "vitest";

import { runLeftPaneScenario } from "./helpers";

it("left-pane scenario: no symbol when lines are changed before a function", () => {
  const leftPane = runLeftPaneScenario([
    {
      path: "src/calc.ts",
      status: "modified",
      annotated: `
o import { plus } from "../math"
- 
- 
o 
o export function run(a: number, b: number) {
o   const base = plus(a, b)
o   return result
o }
      `
    }
  ]);

  expect(leftPane).toMatchInlineSnapshot(`
    "folder src
      file [modified] src/calc.ts
        top [removed] L2 2 lines removed"
  `);
});
