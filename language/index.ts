import type { AnalyzerContext, LanguageAnalyzer, LanguageDefinition } from "./types";
import { createTypeScriptAnalyzer, isTypeScriptSupportedFile } from "./typescript";

const LANGUAGE_DEFINITIONS: readonly LanguageDefinition[] = [
  {
    createAnalyzer: createTypeScriptAnalyzer,
    isSupportedFile: isTypeScriptSupportedFile
  }
];

export function createLanguageAnalyzers(context: AnalyzerContext): LanguageAnalyzer[] {
  return LANGUAGE_DEFINITIONS.map((definition) => definition.createAnalyzer(context)).filter(
    (analyzer): analyzer is LanguageAnalyzer => analyzer !== null
  );
}

export function isLanguageSupportedFile(filePath: string): boolean {
  return LANGUAGE_DEFINITIONS.some((definition) => definition.isSupportedFile(filePath));
}
