import test from "node:test";
import assert from "node:assert/strict";
import { splitCodeLines, toLoadedProgramState } from "./loadedProgram.ts";
import type { ParseResult } from "../types";

test("toLoadedProgramState keeps only lightweight file metadata", () => {
  const parseResult = {
    filePath: "/tmp/demo.nc",
    fileName: "demo.nc",
    extension: "nc",
    totalLines: 3,
    totalMoves: 2,
    warnings: ["warn"],
    content: "G0 X0\nG1 X1",
    lines: [
      { number: 1, text: "G0 X0" },
      { number: 2, text: "G1 X1" },
    ],
    bounds: {
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 1,
      maxY: 0,
      maxZ: 0,
    },
  } satisfies ParseResult;

  const loaded = toLoadedProgramState(parseResult);

  assert.deepEqual(loaded, {
    filePath: "/tmp/demo.nc",
    fileName: "demo.nc",
    extension: "nc",
    totalLines: 3,
    totalMoves: 2,
    warnings: ["warn"],
    bounds: {
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 1,
      maxY: 0,
      maxZ: 0,
    },
  });
  assert.equal("content" in loaded, false);
  assert.equal("lines" in loaded, false);
});

test("splitCodeLines handles LF and CRLF consistently", () => {
  assert.deepEqual(splitCodeLines("G0 X0\r\nG1 X1\nM30"), ["G0 X0", "G1 X1", "M30"]);
});
