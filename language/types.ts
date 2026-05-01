import type { ChangedFile, SymbolSummary, UsagesResponse } from "../protocol";

export interface AnalyzerContext {
  repoRoot: string;
  changedFiles: readonly ChangedFile[];
}

export interface LanguageSnapshot {
  handledFiles: ReadonlySet<string>;
  symbols: readonly SymbolSummary[];
  usagesBySymbolId: ReadonlyMap<string, UsagesResponse>;
}

export interface LanguageAnalyzer {
  buildSnapshot(): Promise<LanguageSnapshot>;
}

export interface LanguageDefinition {
  createAnalyzer(context: AnalyzerContext): LanguageAnalyzer | null;
  isSupportedFile(filePath: string): boolean;
}
