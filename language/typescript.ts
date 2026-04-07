import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import type {
  LineRange,
  SymbolKind,
  SymbolSummary,
  UsagesResponse,
  UsageRecord
} from "../protocol";
import { listTrackedFiles } from "../review/git";

interface AnalyzerOptions {
  repoRoot: string;
  changedRangesByFile: ReadonlyMap<string, LineRange[]>;
  changedFiles: readonly string[];
}

interface SymbolHandle {
  filePath: string;
  position: number;
  summary: SymbolSummary;
}

interface DeclarationCandidate {
  node: ts.Node;
  kind: SymbolKind;
  name: string;
  nameNode: ts.Node;
  spanStartLine: number;
  spanEndLine: number;
  declarationLine: number;
  declarationColumn: number;
}

export interface TypeScriptAnalyzer {
  findTouchedSymbols(): SymbolSummary[];
  getUsages(symbolId: string): UsagesResponse | null;
}

export function createTypeScriptAnalyzer(options: AnalyzerOptions): TypeScriptAnalyzer | null {
  const sourceFiles = collectSourceFiles(options.repoRoot, options.changedFiles);
  if (sourceFiles.length === 0) {
    return null;
  }

  const compilerOptions = resolveCompilerOptions(options.repoRoot);
  const languageService = ts.createLanguageService(
    createLanguageServiceHost(options.repoRoot, sourceFiles, compilerOptions),
    ts.createDocumentRegistry()
  );

  const program = languageService.getProgram();
  if (!program) {
    return null;
  }

  const symbolHandles = new Map<string, SymbolHandle>();
  const lineCache = new Map<string, string[]>();

  return {
    findTouchedSymbols(): SymbolSummary[] {
      const summaries: SymbolSummary[] = [];
      symbolHandles.clear();

      for (const changedFile of options.changedFiles) {
        if (!isSupportedFile(changedFile)) {
          continue;
        }

        const normalizedPath = normalizePath(changedFile);
        const ranges = options.changedRangesByFile.get(normalizedPath) ?? [];
        if (ranges.length === 0) {
          continue;
        }

        const sourceFile = program.getSourceFile(path.resolve(options.repoRoot, changedFile));
        if (!sourceFile) {
          continue;
        }

        const declarations = collectDeclarationCandidates(sourceFile);
        for (const declaration of declarations) {
          if (!intersectsRanges(declaration.spanStartLine, declaration.spanEndLine, ranges)) {
            continue;
          }

          const topLevelNameNode = findTopLevelDeclarationNameNode(declaration.node);
          if (!topLevelNameNode) {
            continue;
          }

          const declarationPosition = declaration.nameNode.getStart(sourceFile);
          const topLevelPosition = topLevelNameNode.getStart(sourceFile);
          const symbolId = encodeSymbolId(normalizedPath, declarationPosition);
          if (symbolHandles.has(symbolId)) {
            continue;
          }

          const isTopLevel = declarationPosition === topLevelPosition;

          const summary: SymbolSummary = {
            id: symbolId,
            name: declaration.name,
            kind: declaration.kind,
            declaration: {
              filePath: normalizedPath,
              line: declaration.declarationLine,
              column: declaration.declarationColumn
            },
            selectionRange: {
              startLine: declaration.spanStartLine,
              endLine: declaration.spanEndLine
            },
            isDeclarationInDiff: lineInRanges(declaration.declarationLine, ranges),
            scope: isTopLevel ? "top-level" : "local",
            topLevelSymbolId: isTopLevel ? null : encodeSymbolId(normalizedPath, topLevelPosition)
          };

          symbolHandles.set(symbolId, {
            filePath: normalizedPath,
            position: declarationPosition,
            summary
          });
          summaries.push(summary);
        }
      }

      summaries.sort((left, right) => {
        if (left.declaration.filePath !== right.declaration.filePath) {
          return left.declaration.filePath.localeCompare(right.declaration.filePath);
        }
        if (left.declaration.line !== right.declaration.line) {
          return left.declaration.line - right.declaration.line;
        }
        return left.name.localeCompare(right.name);
      });

      return summaries;
    },

    getUsages(symbolId: string): UsagesResponse | null {
      const handle = symbolHandles.get(symbolId);
      if (!handle) {
        return null;
      }

      const absoluteFilePath = path.resolve(options.repoRoot, handle.filePath);
      const references = languageService.findReferences(absoluteFilePath, handle.position);
      const usages: UsageRecord[] = [];
      const seen = new Set<string>();

      for (const referencedSymbol of references ?? []) {
        for (const reference of referencedSymbol.references) {
          const sourceFile = program.getSourceFile(reference.fileName);
          if (!sourceFile) {
            continue;
          }

          const filePath = toRepoPath(options.repoRoot, reference.fileName);
          const lineAndChar = sourceFile.getLineAndCharacterOfPosition(reference.textSpan.start);
          const line = lineAndChar.line + 1;
          const column = lineAndChar.character + 1;

          const dedupeKey = [
            filePath,
            String(line),
            String(column),
            reference.isDefinition ? "1" : "0"
          ].join(":");
          if (seen.has(dedupeKey)) {
            continue;
          }
          seen.add(dedupeKey);

          usages.push({
            location: {
              filePath,
              line,
              column
            },
            isDefinition: Boolean(reference.isDefinition),
            isInDiff: lineInRanges(line, options.changedRangesByFile.get(filePath) ?? []),
            preview: getLinePreview(options.repoRoot, lineCache, filePath, line)
          });
        }
      }

      usages.sort((left, right) => {
        if (left.location.filePath !== right.location.filePath) {
          return left.location.filePath.localeCompare(right.location.filePath);
        }
        if (left.location.line !== right.location.line) {
          return left.location.line - right.location.line;
        }
        if (left.location.column !== right.location.column) {
          return left.location.column - right.location.column;
        }
        return Number(left.isDefinition) - Number(right.isDefinition);
      });

      return {
        symbol: handle.summary,
        usages
      };
    }
  };
}

function collectSourceFiles(repoRoot: string, changedFiles: readonly string[]): string[] {
  const tracked = listTrackedFiles(repoRoot);
  const fileSet = new Set<string>();

  for (const trackedPath of tracked) {
    if (!isSupportedFile(trackedPath)) {
      continue;
    }
    fileSet.add(path.resolve(repoRoot, trackedPath));
  }

  for (const changedPath of changedFiles) {
    if (!isSupportedFile(changedPath)) {
      continue;
    }
    const absolutePath = path.resolve(repoRoot, changedPath);
    if (fs.existsSync(absolutePath)) {
      fileSet.add(absolutePath);
    }
  }

  return [...fileSet];
}

function resolveCompilerOptions(repoRoot: string): ts.CompilerOptions {
  const defaults: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    strict: false,
    skipLibCheck: true
  };

  const configPath = ts.findConfigFile(repoRoot, ts.sys.fileExists);
  if (!configPath) {
    return defaults;
  }

  const rawConfig = ts.readConfigFile(configPath, ts.sys.readFile);
  if (rawConfig.error || !rawConfig.config) {
    return defaults;
  }

  const parsed = ts.parseJsonConfigFileContent(rawConfig.config, ts.sys, path.dirname(configPath));
  return {
    ...defaults,
    ...parsed.options
  };
}

function createLanguageServiceHost(
  repoRoot: string,
  sourceFiles: readonly string[],
  compilerOptions: ts.CompilerOptions
): ts.LanguageServiceHost {
  return {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => [...sourceFiles],
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName) => {
      if (!fs.existsSync(fileName)) {
        return undefined;
      }

      const text = fs.readFileSync(fileName, "utf8");
      return ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => repoRoot,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories
  };
}

function collectDeclarationCandidates(sourceFile: ts.SourceFile): DeclarationCandidate[] {
  const declarations: DeclarationCandidate[] = [];

  const visit = (node: ts.Node): void => {
    const candidate = declarationFromNode(sourceFile, node);
    if (candidate) {
      declarations.push(candidate);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return declarations;
}

const TEST_CALL_ROOT_NAMES = new Set(["describe", "it", "test"]);

function declarationFromNode(sourceFile: ts.SourceFile, node: ts.Node): DeclarationCandidate | null {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return makeCandidate(sourceFile, node, node.name, "function");
  }

  if (ts.isMethodDeclaration(node) && node.name) {
    return makeCandidate(sourceFile, node, node.name, "method");
  }

  if (ts.isClassDeclaration(node) && node.name) {
    return makeCandidate(sourceFile, node, node.name, "class");
  }

  if (ts.isInterfaceDeclaration(node)) {
    return makeCandidate(sourceFile, node, node.name, "interface");
  }

  if (ts.isTypeAliasDeclaration(node)) {
    return makeCandidate(sourceFile, node, node.name, "type");
  }

  if (ts.isEnumDeclaration(node)) {
    return makeCandidate(sourceFile, node, node.name, "enum");
  }

  if (ts.isModuleDeclaration(node)) {
    return makeCandidate(sourceFile, node, node.name, "namespace");
  }

  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return makeCandidate(sourceFile, node, node.name, "variable");
  }

  if (ts.isCallExpression(node)) {
    const testNameNode = nameNodeFromTestCall(node);
    if (testNameNode) {
      return makeCandidate(sourceFile, node, testNameNode, "test");
    }
  }

  return null;
}

function makeCandidate(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  nameNode: ts.Node,
  kind: SymbolKind
): DeclarationCandidate {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  const declaration = sourceFile.getLineAndCharacterOfPosition(nameNode.getStart(sourceFile));

  return {
    node,
    kind,
    name: declarationName(nameNode),
    nameNode,
    spanStartLine: start.line + 1,
    spanEndLine: end.line + 1,
    declarationLine: declaration.line + 1,
    declarationColumn: declaration.character + 1
  };
}

function declarationName(nameNode: ts.Node): string {
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
    return nameNode.text;
  }

  return nameNode.getText();
}

function findTopLevelDeclarationNameNode(node: ts.Node): ts.Node | null {
  let current: ts.Node | undefined = node;

  while (current) {
    if (isDeclarationNode(current) && isTopLevelDeclarationNode(current)) {
      return nameNodeFromDeclarationNode(current);
    }

    current = current.parent;
  }

  return null;
}

function isDeclarationNode(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    (ts.isCallExpression(node) && isTestLikeCallExpression(node))
  );
}

function nameNodeFromDeclarationNode(node: ts.Node): ts.Node | null {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
    return node.name ?? null;
  }

  if (
    ts.isMethodDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node)
  ) {
    return node.name;
  }

  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name;
  }

  if (ts.isCallExpression(node)) {
    return nameNodeFromTestCall(node);
  }

  return null;
}

function isTopLevelDeclarationNode(node: ts.Node): boolean {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node)
  ) {
    return ts.isSourceFile(node.parent);
  }

  if (ts.isVariableDeclaration(node)) {
    return (
      ts.isVariableDeclarationList(node.parent) &&
      ts.isVariableStatement(node.parent.parent) &&
      ts.isSourceFile(node.parent.parent.parent)
    );
  }

  if (ts.isCallExpression(node) && isTestLikeCallExpression(node)) {
    return ts.isExpressionStatement(node.parent) && ts.isSourceFile(node.parent.parent);
  }

  return false;
}

function nameNodeFromTestCall(node: ts.CallExpression): ts.Node | null {
  if (!isTestLikeCallExpression(node)) {
    return null;
  }

  const nameNode = node.arguments[0];
  if (
    !nameNode ||
    (!ts.isStringLiteral(nameNode) &&
      !ts.isNoSubstitutionTemplateLiteral(nameNode) &&
      !ts.isTemplateExpression(nameNode))
  ) {
    return null;
  }

  return nameNode;
}

function isTestLikeCallExpression(node: ts.CallExpression): boolean {
  const rootIdentifierText = rootIdentifierTextFromCallExpression(node);
  return rootIdentifierText !== null && TEST_CALL_ROOT_NAMES.has(rootIdentifierText);
}

function rootIdentifierTextFromCallExpression(node: ts.CallExpression): string | null {
  let current: ts.LeftHandSideExpression = node.expression;

  while (ts.isCallExpression(current)) {
    current = current.expression;
  }

  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = current.expression;
  }

  if (!ts.isIdentifier(current)) {
    return null;
  }

  return current.text;
}

function getLinePreview(
  repoRoot: string,
  lineCache: Map<string, string[]>,
  filePath: string,
  lineNumber: number
): string {
  let lines = lineCache.get(filePath);
  if (!lines) {
    const absolutePath = path.resolve(repoRoot, filePath);
    try {
      lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/);
    } catch {
      lines = [];
    }
    lineCache.set(filePath, lines);
  }

  return (lines[lineNumber - 1] ?? "").trim();
}

function lineInRanges(line: number, ranges: readonly LineRange[]): boolean {
  for (const range of ranges) {
    if (line >= range.startLine && line <= range.endLine) {
      return true;
    }
  }
  return false;
}

function intersectsRanges(startLine: number, endLine: number, ranges: readonly LineRange[]): boolean {
  for (const range of ranges) {
    if (endLine >= range.startLine && startLine <= range.endLine) {
      return true;
    }
  }
  return false;
}

function encodeSymbolId(filePath: string, position: number): string {
  return Buffer.from(JSON.stringify({ filePath, position }), "utf8").toString("base64url");
}

function toRepoPath(repoRoot: string, absolutePath: string): string {
  return normalizePath(path.relative(repoRoot, absolutePath));
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

export const __internal = {
  lineInRanges,
  intersectsRanges,
  encodeSymbolId,
  toRepoPath,
  normalizePath
};

export function isTypeScriptSupportedFile(filePath: string): boolean {
  return /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(filePath);
}

function isSupportedFile(filePath: string): boolean {
  return isTypeScriptSupportedFile(filePath);
}
