import { expect, it } from "vitest";

import { runLeftPaneScenario } from "./helpers";

it("left-pane scenario: hunk at end of file", () => {
  const leftPane = runLeftPaneScenario([
    {
      path: "src/calc.ts",
      status: "modified",
      annotated: `
o export const one = 1
- export const two = 2
      `
    }
  ]);

  expect(leftPane).toMatchInlineSnapshot(`
    "folder src
      file [modified] src/calc.ts
        top [removed] L2 1 lines removed"
  `);
});
