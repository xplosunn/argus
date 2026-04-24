export type SymbolKind =
  | "file"
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "enum"
  | "namespace"
  | "test"
  | "unknown";

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied";

export interface Location {
  filePath: string;
  line: number;
  column: number;
}

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface ReviewInfo {
  repoRoot: string;
  defaultBranch: string;
  baseSha: string;
  headSha: string;
  mode: "branch-diff" | "working-tree";
  generatedAt: string;
}

export interface ChangedFile {
  path: string;
  status: ChangeStatus;
  changedRanges: LineRange[];
  content: string | null;
  patch: string | null;
}

export interface SymbolSummary {
  id: string;
  name: string;
  kind: SymbolKind;
  declaration: Location;
  selectionRange: LineRange;
  isDeclarationInDiff: boolean;
  scope: "top-level" | "local";
  topLevelSymbolId: string | null;
}

export interface BootstrapResponse {
  review: ReviewInfo;
  files: ChangedFile[];
  symbols: SymbolSummary[];
}

export interface ReviewDependencyGraphNode {
  id: string;
  filePath: string;
  status: ChangeStatus | "unchanged";
  touchedSymbolCount: number;
}

export interface ReviewDependencyGraphEdge {
  id: string;
  sourceFilePath: string;
  targetFilePath: string;
}

export interface ReviewDependencyGraph {
  nodes: ReviewDependencyGraphNode[];
  edges: ReviewDependencyGraphEdge[];
}

export interface FileContentResponse {
  filePath: string;
  content: string | null;
}

export interface UsagesRequest {
  symbolId: string;
}

export interface UsageRecord {
  location: Location;
  isDefinition: boolean;
  isInDiff: boolean;
  preview: string;
}

export interface UsagesResponse {
  symbol: SymbolSummary;
  usages: UsageRecord[];
}

export interface StaticReviewBundle {
  bootstrap: BootstrapResponse;
  fileContentsByPath: Record<string, string | null>;
  usagesBySymbolId: Record<string, UsagesResponse>;
  dependencyGraph: ReviewDependencyGraph;
}
