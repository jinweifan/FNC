export type MotionType = "Rapid" | "Linear" | "ArcCw" | "ArcCcw";
export type NcMode = "normal" | "laser";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface NcLine {
  number: number;
  text: string;
  motion?: MotionType;
  x?: number;
  y?: number;
  z?: number;
  feed?: number;
}

export interface ParseResult {
  filePath: string;
  fileName: string;
  extension: string;
  totalLines: number;
  totalMoves: number;
  warnings: string[];
  content: string;
  lines: NcLine[];
  bounds: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
  };
}

export interface MachineProfile {
  filePath: string;
  profileType: string;
  postName: string;
  machineType: string;
  version: string;
  options: Record<string, string>;
  warnings: string[];
}

export interface ToolItem {
  index: number;
  raw: string;
}

export interface ToolLibrary {
  filePath: string;
  name: string;
  version: string;
  items: ToolItem[];
}

export type SimulationSpeed = "Low" | "Standard" | "High";

export interface SimulationSession {
  sessionId: number;
  frameCount: number;
  currentIndex: number;
  speed: SimulationSpeed;
  followTool: boolean;
  currentLine: number;
  currentPosition: Vec3;
}

export type StepMode = "Next" | "Prev" | "ToStart" | "ToEnd";

export interface FrameState {
  index: number;
  lineNumber: number;
  position: Vec3;
  motion?: MotionType;
  axisDomain?: "xyz" | "uvw";
  pausedByBreakpoint: boolean;
}

export interface CameraState {
  target: Vec3;
  position: Vec3;
  zoom: number;
  viewName: string;
}

export interface FollowState {
  sessionId: number;
  followTool: boolean;
}

export interface NcFileItem {
  path: string;
  fileName: string;
  sizeBytes: number;
  createdAtMs: number;
}
