import { describe, expect, it } from "vitest";
import { gasKeySurface, mlDsa65Surface } from "../recipes/source.mjs";

// The quickstart snippets are documentation, never executed by the test suite.
// This check keeps them honest cheaply: every named import from an @fastnear
// package, and every `actions.<builder>(` reference, must exist on the module
// the snippet imports it from (vitest aliases the workspaces to their sources).

const surfaces = [
  ["gasKeySurface", gasKeySurface],
  ["mlDsa65Surface", mlDsa65Surface],
];

const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*"(@fastnear\/[a-z0-9-]+)"/g;
const BUILDER_RE = /\bactions\.([A-Za-z0-9_]+)\(/g;

function importedNames(clause) {
  return clause
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith("type "))
    .map((part) => part.split(/\s+as\s+/)[0].trim());
}

for (const [surfaceName, surface] of surfaces) {
  describe(`${surfaceName} quickstarts import real exports`, () => {
    for (const quickstart of surface.quickstarts) {
      it(quickstart.id, async () => {
        const imports = [...quickstart.code.matchAll(IMPORT_RE)];
        expect(imports.length, "quickstart has at least one @fastnear import").toBeGreaterThan(0);
        for (const [, clause, moduleName] of imports) {
          const mod = await import(moduleName);
          for (const name of importedNames(clause)) {
            expect(name in mod, `${moduleName} exports ${name}`).toBe(true);
          }
        }
        const usesActions = imports.some(([, clause]) => importedNames(clause).includes("actions"));
        if (usesActions) {
          const api = await import("@fastnear/api");
          for (const [, builder] of quickstart.code.matchAll(BUILDER_RE)) {
            expect(typeof api.actions[builder], `actions.${builder} is a builder`).toBe("function");
          }
        }
      });
    }
  });
}
