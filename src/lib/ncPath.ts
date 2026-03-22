import type { FrameState, MotionType, NcMode } from "../types";

type ModalMotion = MotionType;

interface ModalState {
  absolute: boolean;
  motion: ModalMotion;
  x: number;
  y: number;
  z: number;
}

interface Words {
  [key: string]: number;
}

const TAU = Math.PI * 2;

function cleanLine(line: string): string {
  return line.replace(/\([^)]*\)/g, "").replace(/;.*$/g, "").trim().toUpperCase();
}

function parseWords(line: string): Words {
  const out: Words = {};
  const regex = /([A-Z])([+-]?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null = regex.exec(line);
  while (m) {
    out[m[1]] = Number(m[2]);
    m = regex.exec(line);
  }
  return out;
}

function hasMotionCode(line: string): MotionType | null {
  if (/\bG0?0\b/.test(line)) return "Rapid";
  if (/\bG0?1\b/.test(line)) return "Linear";
  if (/\bG0?2\b/.test(line)) return "ArcCw";
  if (/\bG0?3\b/.test(line)) return "ArcCcw";
  return null;
}

function hasAxis(words: Words, mode: NcMode): boolean {
  if (mode === "laser") {
    return ["X", "Y", "Z", "U", "V", "W"].some((k) => typeof words[k] === "number");
  }
  return ["X", "Y", "Z"].some((k) => typeof words[k] === "number");
}

function resolveLaserDomain(words: Words, current: "xyz" | "uvw"): "xyz" | "uvw" {
  const hasXYZ = typeof words.X === "number" || typeof words.Y === "number" || typeof words.Z === "number";
  const hasUVW = typeof words.U === "number" || typeof words.V === "number" || typeof words.W === "number";
  if (hasUVW && !hasXYZ) return "uvw";
  if (hasXYZ && !hasUVW) return "xyz";
  if (hasUVW && hasXYZ) return current;
  return current;
}

function toTarget(
  state: ModalState,
  words: Words,
  mode: NcMode,
  forceDomain?: "xyz" | "uvw",
) {
  const target = { x: state.x, y: state.y, z: state.z };
  let axisDomain: "xyz" | "uvw" = forceDomain ?? "xyz";

  if (mode === "laser") {
    if (!forceDomain) axisDomain = resolveLaserDomain(words, axisDomain);
    const xWord = axisDomain === "uvw" ? words.U : words.X;
    const yWord = axisDomain === "uvw" ? words.V : words.Y;
    const zWord = axisDomain === "uvw"
      ? (typeof words.W === "number" ? -words.W : undefined)
      : words.Z;

    if (typeof xWord === "number") target.x = state.absolute ? xWord : state.x + xWord;
    if (typeof yWord === "number") target.y = state.absolute ? yWord : state.y + yWord;
    if (typeof zWord === "number") target.z = state.absolute ? zWord : state.z + zWord;

    return { target, axisDomain };
  }

  if (typeof words.X === "number") target.x = state.absolute ? words.X : state.x + words.X;
  if (typeof words.Y === "number") target.y = state.absolute ? words.Y : state.y + words.Y;
  if (typeof words.Z === "number") target.z = state.absolute ? words.Z : state.z + words.Z;

  return { target, axisDomain };
}

function sweepFrom(centerX: number, centerY: number, startX: number, startY: number, endX: number, endY: number, cw: boolean): number {
  const a0 = Math.atan2(startY - centerY, startX - centerX);
  const a1 = Math.atan2(endY - centerY, endX - centerX);

  let delta = cw ? a0 - a1 : a1 - a0;
  if (delta <= 0) delta += TAU;
  return delta;
}

function centerFromR(startX: number, startY: number, endX: number, endY: number, radius: number, cw: boolean) {
  const dx = endX - startX;
  const dy = endY - startY;
  const chord = Math.hypot(dx, dy);
  const r = Math.abs(radius);

  if (chord < 1e-9) {
    return { x: startX + r, y: startY };
  }

  if (chord > 2 * r + 1e-9) {
    return null;
  }

  const mx = (startX + endX) / 2;
  const my = (startY + endY) / 2;
  const h = Math.sqrt(Math.max(0, r * r - (chord * chord) / 4));

  const ux = -dy / chord;
  const uy = dx / chord;

  const c1 = { x: mx + ux * h, y: my + uy * h };
  const c2 = { x: mx - ux * h, y: my - uy * h };

  const d1 = sweepFrom(c1.x, c1.y, startX, startY, endX, endY, cw);
  const d2 = sweepFrom(c2.x, c2.y, startX, startY, endX, endY, cw);

  const chooseMinor = radius >= 0;
  if (chooseMinor) {
    return d1 <= d2 ? c1 : c2;
  }

  return d1 >= d2 ? c1 : c2;
}

function interpolateArc(
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number },
  words: Words,
  motion: MotionType,
  lineNumber: number,
  indexStart: number,
  axisDomain: "xyz" | "uvw"
): FrameState[] {
  const cw = motion === "ArcCw";
  let centerX: number;
  let centerY: number;

  if (typeof words.I === "number" || typeof words.J === "number") {
    centerX = start.x + (words.I ?? 0);
    centerY = start.y + (words.J ?? 0);
  } else if (typeof words.R === "number") {
    const c = centerFromR(start.x, start.y, end.x, end.y, words.R, cw);
    if (!c) {
      return [
        {
          index: indexStart,
          lineNumber,
          position: end,
          motion,
          axisDomain,
          pausedByBreakpoint: false,
        },
      ];
    }
    centerX = c.x;
    centerY = c.y;
  } else {
    return [
      {
        index: indexStart,
        lineNumber,
        position: end,
        motion,
        axisDomain,
        pausedByBreakpoint: false,
      },
    ];
  }

  const radius = Math.hypot(start.x - centerX, start.y - centerY);
  if (radius < 1e-9) {
    return [
      {
        index: indexStart,
        lineNumber,
        position: end,
        motion,
        axisDomain,
        pausedByBreakpoint: false,
      },
    ];
  }

  const startAng = Math.atan2(start.y - centerY, start.x - centerX);
  let sweep = sweepFrom(centerX, centerY, start.x, start.y, end.x, end.y, cw);

  if (Math.abs(end.x - start.x) < 1e-8 && Math.abs(end.y - start.y) < 1e-8) {
    sweep = TAU;
  }

  const segCount = Math.max(12, Math.min(256, Math.ceil((radius * sweep) / 5)));
  const dz = (end.z - start.z) / segCount;

  const out: FrameState[] = [];
  for (let i = 1; i <= segCount; i += 1) {
    const t = i / segCount;
    const ang = cw ? startAng - sweep * t : startAng + sweep * t;
    out.push({
      index: indexStart + out.length,
      lineNumber,
      position: {
        x: centerX + Math.cos(ang) * radius,
        y: centerY + Math.sin(ang) * radius,
        z: start.z + dz * i,
      },
      motion,
      axisDomain,
      pausedByBreakpoint: false,
    });
  }

  return out;
}

export function parseNcToFrames(content: string, mode: NcMode = "normal"): FrameState[] {
  const lines = content.split(/\r?\n/);
  const state: ModalState = {
    absolute: true,
    motion: "Rapid",
    x: 0,
    y: 0,
    z: 0,
  };
  const laserDomainState: Record<"xyz" | "uvw", { x: number; y: number; z: number }> = {
    xyz: { x: 0, y: 0, z: 0 },
    uvw: { x: 0, y: 0, z: 0 },
  };
  let currentLaserDomain: "xyz" | "uvw" = "xyz";

  const frames: FrameState[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const clean = cleanLine(lines[i]);
    if (!clean) continue;

    if (/\bG90\b/.test(clean)) state.absolute = true;
    if (/\bG91\b/.test(clean)) state.absolute = false;

    const motionInLine = hasMotionCode(clean);
    if (motionInLine) {
      state.motion = motionInLine;
    }

    const words = parseWords(clean);
    if (!hasAxis(words, mode)) continue;

    let axisDomain: "xyz" | "uvw" = "xyz";
    if (mode === "laser") {
      currentLaserDomain = resolveLaserDomain(words, currentLaserDomain);
      axisDomain = currentLaserDomain;
      const domainPos = laserDomainState[axisDomain];
      state.x = domainPos.x;
      state.y = domainPos.y;
      state.z = domainPos.z;
    }
    const start = { x: state.x, y: state.y, z: state.z };
    const mapped = toTarget(state, words, mode, axisDomain);
    const target = mapped.target;

    let added: FrameState[];
    if (state.motion === "ArcCw" || state.motion === "ArcCcw") {
      added = interpolateArc(start, target, words, state.motion, i + 1, frames.length, axisDomain);
    } else {
      added = [
        {
          index: frames.length,
          lineNumber: i + 1,
          position: target,
          motion: state.motion,
          axisDomain,
          pausedByBreakpoint: false,
        },
      ];
    }

    frames.push(...added);
    state.x = target.x;
    state.y = target.y;
    state.z = target.z;
    if (mode === "laser") {
      laserDomainState[axisDomain] = { x: state.x, y: state.y, z: state.z };
    }
  }

  if (!frames.length) {
    frames.push({
      index: 0,
      lineNumber: 1,
      position: { x: 0, y: 0, z: 0 },
      axisDomain: "xyz",
      pausedByBreakpoint: false,
    });
  }

  return frames.map((f, idx) => ({ ...f, index: idx }));
}
