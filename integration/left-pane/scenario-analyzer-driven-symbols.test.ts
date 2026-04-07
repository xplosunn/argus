import { expect, it } from "vitest";

import { runLeftPaneScenario } from "./helpers";

it("left-pane scenario: accepts full-file o/+/- markers for diff and analyzer-driven symbols", () => {
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
+   const result = base
o   return result
o }
      `
    },
    {
      path: "src/styles.css",
      status: "modified",
      annotated: `
o .title {
-   color: red;
+   color: blue;
o }
      `,
      trailingNewline: true
    }
  ]);

  expect(leftPane).toMatchInlineSnapshot(`
    "folder src
      file [modified] src/calc.ts
        top [removed] L2 2 lines removed
        top [modified] L3 function run
          local [added] L5 variable result
      file [modified] src/styles.css
        top [modified] L2 1 lines removed, 1 lines added"
  `);
});
