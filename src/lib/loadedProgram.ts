import type { LoadedProgramState, ParseResult } from "../types";

export function splitCodeLines(content: string): string[] {
  return content.split(/\r?\n/);
}

export function toLoadedProgramState(parseResult: ParseResult): LoadedProgramState {
  const {
    filePath,
    fileName,
    extension,
    totalLines,
    totalMoves,
    warnings,
    bounds,
  } = parseResult;

  return {
    filePath,
    fileName,
    extension,
    totalLines,
    totalMoves,
    warnings,
    bounds,
  };
}
