import { Canvas, useThree } from "@react-three/fiber";
import { Grid, Line, OrbitControls } from "@react-three/drei";
import { MOUSE, Raycaster, Vector2, Vector3 } from "three";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { PerspectiveCamera } from "three";
import type { CameraState, FrameState } from "../types";

type Vec3Like = { x: number; y: number; z: number };
type SegmentRecord = {
  start: Vec3Like;
  end: Vec3Like;
  endFrame: FrameState;
  sourceIndex: number;
  lane: "cut" | "rapid";
};
type HoverTooltipData = {
  segment: SegmentRecord;
  x: number;
  y: number;
};
type NcWord = {
  letter: string;
  value: string;
};

function parseWordsFromNcLine(rawLine: string): NcWord[] {
  const clean = rawLine.replace(/\([^)]*\)/g, "").replace(/;.*$/g, "").toUpperCase();
  const regex = /([A-Z])([+-]?\d+(?:\.\d+)?)/g;
  const out: NcWord[] = [];
  let m: RegExpExecArray | null = regex.exec(clean);
  while (m) {
    out.push({ letter: m[1], value: m[2] });
    m = regex.exec(clean);
  }
  const order = ["G", "M", "T", "X", "Y", "Z", "U", "V", "W", "R", "I", "J", "K", "F", "S", "P", "Q", "H", "D"];
  return out.sort((a, b) => {
    const ia = order.indexOf(a.letter);
    const ib = order.indexOf(b.letter);
    const ra = ia === -1 ? 999 : ia;
    const rb = ib === -1 ? 999 : ib;
    return ra - rb;
  });
}

function framesForCenter(frames: FrameState[]): FrameState[] {
  if (frames.length < 2) return frames;
  const firstCut = frames.findIndex((f, i) => i > 0 && f.motion && f.motion !== "Rapid");
  let base = firstCut > 0 ? frames.slice(Math.max(0, firstCut - 1)) : frames;
  if (base.length < 2) base = frames;

  const p0 = base[0]?.position;
  if (p0) {
    const nearOrigin = Math.hypot(p0.x, p0.y, p0.z) < 1e-6;
    if (nearOrigin && base.length > 2) {
      const withoutFirst = base.slice(1);
      const hasFarPoint = withoutFirst.some((f) => Math.hypot(f.position.x, f.position.y, f.position.z) > 1);
      if (hasFarPoint) base = withoutFirst;
    }
  }
  return base;
}

function sampleSegments(segments: SegmentRecord[], maxCount: number): SegmentRecord[] {
  if (segments.length <= maxCount) return segments;
  const stride = Math.ceil(segments.length / maxCount);
  const out: SegmentRecord[] = [];
  for (let i = 0; i < segments.length; i += stride) out.push(segments[i]);
  const last = segments[segments.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function sampleLinePairs(points: Vector3[], maxSegments: number): Vector3[] {
  if (points.length <= maxSegments * 2) return points;
  const pairCount = Math.floor(points.length / 2);
  const stride = Math.max(1, Math.ceil(pairCount / maxSegments));
  const out: Vector3[] = [];
  for (let p = 0; p < pairCount; p += stride) {
    const i = p * 2;
    out.push(points[i], points[i + 1]);
  }
  return out;
}

function pointToSegmentDistanceSq2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq < 1e-8) return apx * apx + apy * apy;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

function resolveUpVector(position: Vec3Like, target: Vec3Like): Vector3 {
  const dx = position.x - target.x;
  const dy = position.y - target.y;
  const dz = position.z - target.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return new Vector3(0, 1, 0);
  const nz = dz / d;
  // Looking almost straight along Z: use Y-up to avoid gimbal-like roll/flip.
  if (Math.abs(nz) > 0.98) return new Vector3(0, 1, 0);
  return new Vector3(0, 0, 1);
}

function FocusSegment({
  points,
  lineWidth,
}: {
  points: Vector3[] | null;
  lineWidth: number;
}) {
  if (!points || points.length < 2) return null;
  return (
    <Line
      points={points}
      color="#ff4d4f"
      lineWidth={lineWidth}
      segments
      depthTest={false}
      renderOrder={999}
    />
  );
}

function ToolPoint({
  segment,
  sceneScale,
}: {
  segment: Vector3[] | null;
  sceneScale: number;
}) {
  if (!segment || segment.length < 2) return null;
  const end = segment[segment.length - 1];
  const start = segment[segment.length - 2];
  const dir = new Vector3(end.x - start.x, end.y - start.y, end.z - start.z);
  const segLen = dir.length();
  if (segLen < 1e-8) return null;

  dir.normalize();
  // Keep direction marker readable for tiny segments by enforcing a visible minimum size.
  const minArrowLen = Math.max(6, sceneScale * 0.018);
  const maxArrowLen = Math.max(18, sceneScale * 0.09);
  let arrowLen = Math.max(minArrowLen, Math.min(segLen, maxArrowLen));
  let headLen = Math.max(2.4, Math.min(arrowLen * 0.36, sceneScale * 0.03));
  const headWidth = Math.max(1.4, Math.min(headLen * 0.72, sceneScale * 0.018));
  const tinySegmentThreshold = Math.max(3.5, sceneScale * 0.01);
  if (segLen <= tinySegmentThreshold) {
    // Tiny segment: show only arrow head (no shaft/tail).
    arrowLen = headLen;
    headLen = arrowLen;
  }
  // Anchor arrow tip on the current point (segment end), not segment middle.
  const origin = new Vector3(
    end.x - dir.x * arrowLen,
    end.y - dir.y * arrowLen,
    end.z - dir.z * arrowLen,
  );

  return (
    <arrowHelper
      args={[
        dir,
        origin,
        arrowLen,
        0xff3b30,
        headLen,
        headWidth,
      ]}
    />
  );
}

function ViewportCenterOnResize({
  controlsRef,
  sceneRadius,
  enabled,
}: {
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>;
  sceneRadius: number;
  enabled: boolean;
}) {
  const { camera, size } = useThree();

  useEffect(() => {
    if (!enabled || !controlsRef.current || size.width <= 0 || size.height <= 0) return;

    const controls = controlsRef.current;
    const dir = new Vector3().subVectors(camera.position, controls.target);
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
    dir.normalize();

    const cam = camera as PerspectiveCamera;
    const vFov = ((cam.fov ?? 55) * Math.PI) / 180;
    const aspect = Math.max(0.1, size.width / Math.max(1, size.height));
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const radius = Math.max(1, sceneRadius);
    const distV = radius / Math.sin(Math.max(0.1, vFov / 2));
    const distH = radius / Math.sin(Math.max(0.1, hFov / 2));
    const fitDistance = Math.max(120, Math.max(distV, distH) * 1.28);

    const target = controls.target.clone();
    camera.position.copy(target.clone().add(dir.multiplyScalar(fitDistance)));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    controls.target.copy(target);
    controls.update();
  }, [camera, controlsRef, enabled, sceneRadius, size.height, size.width]);

  return null;
}
function RayPickController({
  sampledSegments,
  fullSegments,
  cutSegments,
  rapidSegments,
  enabled,
  sceneScale,
  focusCenter,
  onHoverStateChange,
  onHoverSegment,
  onPickSegment,
  onHoverEnd,
}: {
  sampledSegments: SegmentRecord[];
  fullSegments: SegmentRecord[];
  cutSegments: SegmentRecord[];
  rapidSegments: SegmentRecord[];
  enabled: boolean;
  sceneScale: number;
  focusCenter: Vec3Like;
  onHoverStateChange?: (hovered: boolean) => void;
  onHoverSegment: (segment: SegmentRecord, clientX: number, clientY: number) => void;
  onPickSegment: (segment: SegmentRecord, clientX: number, clientY: number) => void;
  onHoverEnd?: () => void;
}) {
  const { camera, gl } = useThree();

  useEffect(() => {
    if (!sampledSegments.length) return;
    const dom = gl.domElement;
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const segA = new Vector3();
    const segB = new Vector3();
    const ptRay = new Vector3();
    const ptSeg = new Vector3();
    let rafId = 0;
    let pendingMove: PointerEvent | null = null;
    let lastHoverHit: SegmentRecord | null = null;
    let downHit: SegmentRecord | null = null;

    const worldThreshold = () => {
      const cam = camera as PerspectiveCamera;
      const fov = ((cam.fov ?? 55) * Math.PI) / 180;
      const h = Math.max(1, dom.clientHeight);
      const depth = Math.max(
        10,
        Math.hypot(
          camera.position.x - focusCenter.x,
          camera.position.y - focusCenter.y,
          camera.position.z - focusCenter.z,
        ),
      );
      const worldPerPixel = (2 * depth * Math.tan(fov / 2)) / h;
      return Math.max(sceneScale * 0.0052, worldPerPixel * 10.5);
    };

    const pickAt = (clientX: number, clientY: number, preferExact = false, clickExact = false) => {
      const rect = dom.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);

      if (clickExact) {
        const mx = clientX - rect.left;
        const my = clientY - rect.top;
        const pxThreshold = 28;
        const pxThresholdSq = pxThreshold * pxThreshold;
        const pa = new Vector3();
        const pb = new Vector3();
        let best: SegmentRecord | null = null;
        let bestD2 = Number.POSITIVE_INFINITY;
        for (const seg of fullSegments) {
          pa.set(seg.start.x, seg.start.y, seg.start.z).project(camera);
          pb.set(seg.end.x, seg.end.y, seg.end.z).project(camera);
          if (!Number.isFinite(pa.x) || !Number.isFinite(pa.y) || !Number.isFinite(pb.x) || !Number.isFinite(pb.y)) continue;
          const ax = (pa.x * 0.5 + 0.5) * rect.width;
          const ay = (-pa.y * 0.5 + 0.5) * rect.height;
          const bx = (pb.x * 0.5 + 0.5) * rect.width;
          const by = (-pb.y * 0.5 + 0.5) * rect.height;
          const d2 = pointToSegmentDistanceSq2D(mx, my, ax, ay, bx, by);
          if (d2 < bestD2) {
            bestD2 = d2;
            best = seg;
          }
        }
        if (best && bestD2 <= pxThresholdSq) return best;
        if (best) return best;
      }

      const threshold = worldThreshold() * (preferExact ? 1.35 : 1);
      const thresholdSq = threshold * threshold;
      const coarsePool = clickExact ? fullSegments : sampledSegments;
      let coarse: SegmentRecord | null = null;
      let coarseD2 = Number.POSITIVE_INFINITY;
      for (const seg of coarsePool) {
        segA.set(seg.start.x, seg.start.y, seg.start.z);
        segB.set(seg.end.x, seg.end.y, seg.end.z);
        const d2 = raycaster.ray.distanceSqToSegment(segA, segB, ptRay, ptSeg);
        if (d2 < coarseD2 && d2 <= thresholdSq) {
          coarseD2 = d2;
          coarse = seg;
        }
      }
      if (!coarse) return null;
      if (clickExact) return coarse;

      const full = clickExact ? fullSegments : (coarse.lane === "cut" ? cutSegments : rapidSegments);
      const halfWindow = Math.max(60, Math.min(420, Math.floor(full.length * 0.012)));
      const from = Math.max(0, coarse.sourceIndex - halfWindow);
      const to = Math.min(full.length - 1, coarse.sourceIndex + halfWindow);

      let best = coarse;
      let bestD2 = coarseD2;
      for (let i = from; i <= to; i += 1) {
        const seg = full[i];
        segA.set(seg.start.x, seg.start.y, seg.start.z);
        segB.set(seg.end.x, seg.end.y, seg.end.z);
        const d2 = raycaster.ray.distanceSqToSegment(segA, segB, ptRay, ptSeg);
        if (d2 < bestD2 && d2 <= thresholdSq) {
          bestD2 = d2;
          best = seg;
        }
      }
      return best;
    };

    const flushMove = () => {
      rafId = 0;
      if (!pendingMove) return;
      const hit = pickAt(pendingMove.clientX, pendingMove.clientY);
      if (hit) {
        lastHoverHit = hit;
        onHoverStateChange?.(true);
        onHoverSegment(hit, pendingMove.clientX, pendingMove.clientY);
      } else {
        lastHoverHit = null;
        onHoverStateChange?.(false);
        onHoverEnd?.();
      }
      pendingMove = null;
    };

    const onMove = (e: PointerEvent) => {
      if (!enabled || pointerDown) return;
      pendingMove = e;
      if (!rafId) rafId = window.requestAnimationFrame(flushMove);
    };

    const onLeave = () => {
      lastHoverHit = null;
      onHoverStateChange?.(false);
      onHoverEnd?.();
    };

    let downX = 0;
    let downY = 0;
    let pointerDown = false;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      pointerDown = true;
      downX = e.clientX;
      downY = e.clientY;
      downHit = pickAt(e.clientX, e.clientY, true);
      if (downHit) {
        onHoverStateChange?.(true);
        onPickSegment(downHit, e.clientX, e.clientY);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!pointerDown) return;
      pointerDown = false;
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved > 28) return;
      const hit = pickAt(e.clientX, e.clientY, true, true) ?? downHit ?? lastHoverHit;
      if (hit) {
        onHoverStateChange?.(true);
        onPickSegment(hit, e.clientX, e.clientY);
      }
      downHit = null;
    };

    dom.addEventListener("pointermove", onMove, { passive: true });
    dom.addEventListener("pointerleave", onLeave, { passive: true });
    dom.addEventListener("pointerdown", onPointerDown, { passive: true });
    dom.addEventListener("pointerup", onPointerUp, { passive: true });
    return () => {
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerleave", onLeave);
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointerup", onPointerUp);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [
    camera,
    cutSegments,
    enabled,
    focusCenter.x,
    focusCenter.y,
    focusCenter.z,
    gl,
    onHoverEnd,
    onHoverSegment,
    onHoverStateChange,
    onPickSegment,
    rapidSegments,
    sampledSegments,
    fullSegments,
    sceneScale,
  ]);

  return null;
}

export function Viewer3D({
  frames,
  codeContent,
  currentFrame,
  hoverFrame,
  cameraState,
  onFramePick,
  onFrameHover,
  onFrameHoverEnd,
  onViewerHotkeyScopeChange,
  onCameraStateChange,
  theme,
  interactionMode,
  showGrid,
  showRapidPath,
  showPathTooltip,
}: {
  frames: FrameState[];
  codeContent?: string;
  currentFrame: FrameState | null;
  hoverFrame?: FrameState | null;
  cameraState: CameraState | null;
  onFramePick?: (frame: FrameState) => void;
  onFrameHover?: (frame: FrameState) => void;
  onFrameHoverEnd?: () => void;
  onViewerHotkeyScopeChange?: (active: boolean) => void;
  onCameraStateChange?: (state: CameraState) => void;
  theme: "light" | "navy" | "dark";
  interactionMode: "pan" | "rotate";
  showGrid: boolean;
  showRapidPath: boolean;
  showPathTooltip: boolean;
}) {
  const { t } = useTranslation();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [isPickTargetHovered, setIsPickTargetHovered] = useState(false);
  const [hoverTooltip, setHoverTooltip] = useState<HoverTooltipData | null>(null);
  const [pickedSegment, setPickedSegment] = useState<SegmentRecord | null>(null);
  const hoverDelayRef = useRef<number | null>(null);
  const adaptiveFactor = useMemo(() => {
    const n = frames.length;
    if (n > 120_000) return 0.28;
    if (n > 60_000) return 0.42;
    if (n > 20_000) return 0.62;
    return 1;
  }, [frames.length]);
  const scaledCount = useCallback((base: number, floor = 1200) => {
    return Math.max(floor, Math.floor(base * adaptiveFactor));
  }, [adaptiveFactor]);
  const canvasDpr = useMemo<[number, number]>(() => {
    if (adaptiveFactor <= 0.42) return [0.55, 0.9];
    if (adaptiveFactor < 1) return [0.7, 1];
    return [0.85, 1.25];
  }, [adaptiveFactor]);
  const codeLines = useMemo(() => codeContent?.split(/\r?\n/) ?? [], [codeContent]);
  const segmentData = useMemo(() => {
    const cutPoints: Vector3[] = [];
    const uvwPoints: Vector3[] = [];
    const plungePoints: Vector3[] = [];
    const rapidPoints: Vector3[] = [];
    const cutSegments: SegmentRecord[] = [];
    const rapidSegments: SegmentRecord[] = [];
    const lastByDomain: Record<"xyz" | "uvw", Vec3Like | null> = {
      xyz: null,
      uvw: null,
    };
    const explicitWByLine = new Map<number, number>();
    for (let i = 0; i < codeLines.length; i += 1) {
      const raw = codeLines[i];
      if (!raw) continue;
      const clean = raw.replace(/\([^)]*\)/g, "").replace(/;.*$/g, "").toUpperCase();
      const matches = [...clean.matchAll(/\bW([+-]?\d+(?:\.\d+)?)\b/g)];
      if (!matches.length) continue;
      const last = matches[matches.length - 1];
      const value = Number(last[1]);
      if (Number.isFinite(value)) explicitWByLine.set(i + 1, value);
    }
    // Build modal W table (same semantics as NC axes: omitted word keeps previous value).
    const modalWByLine = new Map<number, number>();
    let modalW: number | null = null;
    for (let line = 1; line <= codeLines.length; line += 1) {
      const explicit = explicitWByLine.get(line);
      if (explicit !== undefined) modalW = explicit;
      if (modalW !== null) modalWByLine.set(line, modalW);
    }
    let lastWValue: number | null = null;

    for (let i = 1; i < frames.length; i += 1) {
      const a = frames[i - 1];
      const b = frames[i];
      const domain = b.axisDomain ?? "xyz";
      const plungeBase = lastByDomain[domain] ?? a.position;
      // Domain-local plunge classification:
      // - XYZ (front): Z decreasing means tool goes down.
      // - UVW (back side): enforce user's W-rule strictly: W2 < W1 means plunge.
      const currentW = modalWByLine.get(b.lineNumber);
      const prevW = modalWByLine.get(a.lineNumber) ?? lastWValue;
      const isPlunge = domain === "uvw"
        ? (currentW !== undefined && prevW !== null && prevW !== undefined && currentW < prevW - 1e-6)
        : b.position.z < plungeBase.z - 1e-6;
      if (b.motion === "Rapid") {
        const seg: SegmentRecord = {
          start: a.position,
          end: b.position,
          endFrame: b,
          sourceIndex: rapidSegments.length,
          lane: "rapid",
        };
        rapidSegments.push(seg);
        rapidPoints.push(new Vector3(a.position.x, a.position.y, a.position.z));
        rapidPoints.push(new Vector3(b.position.x, b.position.y, b.position.z));
        // Laser (UVW->Z mapped) can perform plunge on rapid moves too.
        // Keep plunge highlighting consistent with front-side yellow segments.
        if (isPlunge) {
          plungePoints.push(new Vector3(plungeBase.x, plungeBase.y, plungeBase.z));
          plungePoints.push(new Vector3(b.position.x, b.position.y, b.position.z));
          // Keep plunge segments pickable even when rapid-path display is hidden.
          cutSegments.push({
            start: plungeBase,
            end: b.position,
            endFrame: b,
            sourceIndex: cutSegments.length,
            lane: "cut",
          });
        }
      } else {
        const seg: SegmentRecord = {
          start: a.position,
          end: b.position,
          endFrame: b,
          sourceIndex: cutSegments.length,
          lane: "cut",
        };
        cutSegments.push(seg);
        if (b.axisDomain === "uvw") {
          uvwPoints.push(new Vector3(a.position.x, a.position.y, a.position.z));
          uvwPoints.push(new Vector3(b.position.x, b.position.y, b.position.z));
          if (isPlunge) {
            // Laser-integrated (UVW) plunge segments should also be highlighted in yellow.
            plungePoints.push(new Vector3(plungeBase.x, plungeBase.y, plungeBase.z));
            plungePoints.push(new Vector3(b.position.x, b.position.y, b.position.z));
          }
        } else if (isPlunge) {
          plungePoints.push(new Vector3(plungeBase.x, plungeBase.y, plungeBase.z));
          plungePoints.push(new Vector3(b.position.x, b.position.y, b.position.z));
        } else {
          cutPoints.push(new Vector3(a.position.x, a.position.y, a.position.z));
          cutPoints.push(new Vector3(b.position.x, b.position.y, b.position.z));
        }
      }
      if (domain === "uvw" && currentW !== undefined) lastWValue = currentW;
      lastByDomain[domain] = b.position;
    }

    return { cutPoints, uvwPoints, plungePoints, rapidPoints, cutSegments, rapidSegments };
  }, [codeLines, frames]);
  const pickCutSegments = useMemo(
    () => sampleSegments(segmentData.cutSegments, scaledCount(9000, 1800)),
    [scaledCount, segmentData.cutSegments],
  );
  const pickRapidSegments = useMemo(
    () => sampleSegments(segmentData.rapidSegments, scaledCount(4500, 900)),
    [scaledCount, segmentData.rapidSegments],
  );
  const sampledPickSegments = useMemo(
    () => (showRapidPath ? [...pickCutSegments, ...pickRapidSegments] : pickCutSegments),
    [pickCutSegments, pickRapidSegments, showRapidPath],
  );
  const fullPickSegments = useMemo(
    () => (showRapidPath ? [...segmentData.cutSegments, ...segmentData.rapidSegments] : segmentData.cutSegments),
    [segmentData.cutSegments, segmentData.rapidSegments, showRapidPath],
  );
  const centerFrames = useMemo(() => framesForCenter(frames), [frames]);
  const renderCutPoints = useMemo(
    () => sampleLinePairs(segmentData.cutPoints, isPointerDown ? scaledCount(9000, 1800) : scaledCount(28000, 3200)),
    [isPointerDown, scaledCount, segmentData.cutPoints],
  );
  const renderPlungePoints = useMemo(
    () => sampleLinePairs(segmentData.plungePoints, isPointerDown ? scaledCount(4200, 900) : scaledCount(14000, 1800)),
    [isPointerDown, scaledCount, segmentData.plungePoints],
  );
  const renderUvwPoints = useMemo(
    () => sampleLinePairs(segmentData.uvwPoints, isPointerDown ? scaledCount(7000, 1400) : scaledCount(22000, 2800)),
    [isPointerDown, scaledCount, segmentData.uvwPoints],
  );
  const renderRapidPoints = useMemo(
    () => sampleLinePairs(segmentData.rapidPoints, isPointerDown ? scaledCount(6000, 1000) : scaledCount(18000, 2400)),
    [isPointerDown, scaledCount, segmentData.rapidPoints],
  );

  const sceneScale = useMemo(() => {
    if (!centerFrames.length) return 100;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const f of centerFrames) {
      minX = Math.min(minX, f.position.x);
      minY = Math.min(minY, f.position.y);
      minZ = Math.min(minZ, f.position.z);
      maxX = Math.max(maxX, f.position.x);
      maxY = Math.max(maxY, f.position.y);
      maxZ = Math.max(maxZ, f.position.z);
    }
    return Math.max(80, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ));
  }, [centerFrames]);
  const geometryCenter = useMemo(() => {
    if (!centerFrames.length) return new Vector3(0, 0, 0);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const f of centerFrames) {
      minX = Math.min(minX, f.position.x);
      minY = Math.min(minY, f.position.y);
      minZ = Math.min(minZ, f.position.z);
      maxX = Math.max(maxX, f.position.x);
      maxY = Math.max(maxY, f.position.y);
      maxZ = Math.max(maxZ, f.position.z);
    }
    return new Vector3((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
  }, [centerFrames]);
  const markerFrame = currentFrame ?? hoverFrame ?? null;

  const focusSegment = useMemo(() => {
    if (!markerFrame || frames.length < 2) return null;
    if (
      pickedSegment &&
      pickedSegment.endFrame.index === markerFrame.index &&
      pickedSegment.endFrame.lineNumber === markerFrame.lineNumber
    ) {
      return [
        new Vector3(pickedSegment.start.x, pickedSegment.start.y, pickedSegment.start.z),
        new Vector3(pickedSegment.end.x, pickedSegment.end.y, pickedSegment.end.z),
      ];
    }
    const markerIdx = typeof markerFrame.index === "number"
      ? Math.max(0, Math.min(frames.length - 1, markerFrame.index))
      : Math.max(0, frames.findIndex((f) => f.lineNumber === markerFrame.lineNumber));

    // Prefer exact frame-index segment for progress scrubber sync reliability.
    const makeSeg = (aIdx: number, bIdx: number) => {
      if (aIdx < 0 || bIdx < 0 || aIdx >= frames.length || bIdx >= frames.length) return null;
      const a = frames[aIdx].position;
      const b = frames[bIdx].position;
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (len < 1e-8) return null;
      return [new Vector3(a.x, a.y, a.z), new Vector3(b.x, b.y, b.z)];
    };

    const exact = markerIdx > 0 ? makeSeg(markerIdx - 1, markerIdx) : makeSeg(0, 1);
    if (exact) return exact;

    // Editor-driven sync: prefer a real segment from the same NC line.
    const line = markerFrame.lineNumber;
    let bestSameLine: Vector3[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 1; i < frames.length; i += 1) {
      if (frames[i].lineNumber !== line) continue;
      const seg = makeSeg(i - 1, i);
      if (!seg) continue;
      const score = Math.abs(i - markerIdx);
      if (score < bestScore) {
        bestScore = score;
        bestSameLine = seg;
      }
    }
    if (bestSameLine) return bestSameLine;

    // If current frame is degenerate, walk neighbors to find nearest visible segment.
    for (let d = 1; d < Math.min(60, frames.length); d += 1) {
      const left = markerIdx - d;
      const right = markerIdx + d;
      const leftSeg = left > 0 ? makeSeg(left - 1, left) : null;
      if (leftSeg) return leftSeg;
      const rightSeg = right < frames.length ? makeSeg(Math.max(0, right - 1), right) : null;
      if (rightSeg) return rightSeg;
    }

    // Last fallback: aggregate all segments for current line (for interpolated arc lines).
    const fallbackLine = markerFrame.lineNumber;
    const all: Vector3[] = [];
    for (let i = 1; i < frames.length; i += 1) {
      if (frames[i].lineNumber !== fallbackLine) continue;
      const seg = makeSeg(i - 1, i);
      if (!seg) continue;
      all.push(seg[0], seg[1]);
    }
    return all.length > 1 ? all : null;
  }, [markerFrame, frames, pickedSegment]);

  const focusWidth = markerFrame?.motion === "Rapid" ? 1.2 : 1.8;
  const hoverInfo = useMemo(() => {
    if (!hoverTooltip) return null;
    const seg = hoverTooltip.segment;
    const dx = seg.end.x - seg.start.x;
    const dy = seg.end.y - seg.start.y;
    const dz = seg.end.z - seg.start.z;
    const length = Math.hypot(dx, dy, dz);
    const isCurve = seg.endFrame.motion === "ArcCw" || seg.endFrame.motion === "ArcCcw";
    const rawLine = codeLines[Math.max(0, (seg.endFrame.lineNumber ?? 1) - 1)] ?? "";
    const words = parseWordsFromNcLine(rawLine);
    return {
      isCurve,
      line: seg.endFrame.lineNumber,
      motionLabel: isCurve
        ? (seg.endFrame.motion === "ArcCw" ? "G02" : "G03")
        : (seg.endFrame.motion === "Rapid" ? "G00" : "G01"),
      start: seg.start,
      end: seg.end,
      angleXY: Math.atan2(dy, dx) * (180 / Math.PI),
      length,
      chord: Math.hypot(dx, dy),
      words,
    };
  }, [codeLines, hoverTooltip]);

  const queueHoverTooltip = (seg: SegmentRecord, clientX: number, clientY: number) => {
    if (!showPathTooltip) return;
    if (hoverDelayRef.current) window.clearTimeout(hoverDelayRef.current);
    const nextData = { segment: seg, x: clientX, y: clientY };
    if (hoverTooltip && hoverTooltip.segment.endFrame.index === seg.endFrame.index) {
      setHoverTooltip(nextData);
      return;
    }
    hoverDelayRef.current = window.setTimeout(() => {
      setHoverTooltip(nextData);
    }, 1000);
  };

  const clearHoverTooltip = () => {
    if (hoverDelayRef.current) window.clearTimeout(hoverDelayRef.current);
    hoverDelayRef.current = null;
    setHoverTooltip(null);
  };

  useEffect(() => () => {
    if (hoverDelayRef.current) window.clearTimeout(hoverDelayRef.current);
  }, []);

  useEffect(() => {
    if (!pickedSegment || !currentFrame) return;
    const sameFrame =
      pickedSegment.endFrame.index === currentFrame.index &&
      pickedSegment.endFrame.lineNumber === currentFrame.lineNumber;
    if (!sameFrame) setPickedSegment(null);
  }, [currentFrame, pickedSegment]);

  useEffect(() => {
    if (!cameraState || !controlsRef.current) return;
    controlsRef.current.minDistance = Math.max(8, sceneScale * 0.03);
    controlsRef.current.maxDistance = Math.max(400, sceneScale * 10);
    const sourcePos = new Vector3(
      cameraState.position.x,
      cameraState.position.y,
      cameraState.position.z,
    );
    const sourceTarget = new Vector3(cameraState.target.x, cameraState.target.y, cameraState.target.z);
    const absoluteTarget = frames.length > 1 ? geometryCenter.clone() : sourceTarget;
    const dir = new Vector3().subVectors(sourcePos, sourceTarget);
    const distance = Math.max(sceneScale * 0.5, dir.length());
    const absolutePos = absoluteTarget.clone().add(
      (dir.lengthSq() > 1e-8 ? dir.normalize() : new Vector3(0, 0, 1)).multiplyScalar(distance),
    );
    controlsRef.current.object.position.copy(absolutePos);
    const up = resolveUpVector(
      { x: absolutePos.x, y: absolutePos.y, z: absolutePos.z },
      { x: absoluteTarget.x, y: absoluteTarget.y, z: absoluteTarget.z },
    );
    controlsRef.current.object.up.copy(up);
    controlsRef.current.target.copy(absoluteTarget);
    controlsRef.current.object.lookAt(
      absoluteTarget.x,
      absoluteTarget.y,
      absoluteTarget.z,
    );
    controlsRef.current.object.updateProjectionMatrix();
    controlsRef.current.update();
  }, [cameraState, geometryCenter, frames.length, sceneScale]);

  const cameraEmitRafRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (cameraEmitRafRef.current !== null) {
        window.cancelAnimationFrame(cameraEmitRafRef.current);
        cameraEmitRafRef.current = null;
      }
    };
  }, []);

  const isLight = theme === "light";
  const isNavy = theme === "navy";
  const background = isLight ? "#eef3fb" : (isNavy ? "#0a1427" : "#16181c");
  const lineColor = isLight ? "#0284c7" : (isNavy ? "#22d3ee" : "#1d9bf0");
  const gridCell = isLight ? "#cbd5e1" : (isNavy ? "#334155" : "#2f3336");
  const gridSection = isLight ? "#94a3b8" : (isNavy ? "#475569" : "#3d4144");
  const cameraInit = cameraState
    ? {
      position: [
        cameraState.position.x,
        cameraState.position.y,
        cameraState.position.z,
      ] as [number, number, number],
      fov: 55,
      near: 0.1,
      far: 200000,
    }
    : { position: [120, 120, 120] as [number, number, number], fov: 55, near: 0.1, far: 200000 };

  return (
    <div
      className={`viewer-canvas-wrap mode-${interactionMode}${isPointerDown ? " dragging" : ""}${isPickTargetHovered ? " pick-hover" : ""}`}
      tabIndex={0}
      onPointerDown={(e) => {
        setIsPointerDown(true);
        // Keyboard shortcuts should only be active when the 3D viewport is focused.
        (e.currentTarget as HTMLDivElement).focus();
        onViewerHotkeyScopeChange?.(true);
      }}
      onPointerUp={() => setIsPointerDown(false)}
      onPointerCancel={() => setIsPointerDown(false)}
      onFocus={() => onViewerHotkeyScopeChange?.(true)}
      onBlur={() => onViewerHotkeyScopeChange?.(false)}
      onPointerLeave={() => {
        setIsPointerDown(false);
        clearHoverTooltip();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        camera={cameraInit}
        dpr={canvasDpr}
        gl={{ antialias: true, powerPreference: "high-performance", alpha: false, stencil: false }}
        onPointerMissed={() => {
          setIsPickTargetHovered(false);
          onFrameHoverEnd?.();
        }}
      >
        <color attach="background" args={[background]} />
        <ambientLight intensity={0.65} />
        <directionalLight intensity={1.1} position={[120, 120, 160]} />
        {showGrid && (
          <Grid
            infiniteGrid
            followCamera
            cellSize={Math.max(1, sceneScale / 72)}
            sectionSize={Math.max(6, sceneScale / 14)}
            cellThickness={0.55}
            sectionThickness={1.05}
            position={[geometryCenter.x, geometryCenter.y, geometryCenter.z]}
            rotation={[Math.PI / 2, 0, 0]}
            cellColor={gridCell}
            sectionColor={gridSection}
            fadeDistance={1_000_000}
            fadeStrength={0}
          />
        )}
        <axesHelper args={[120]} />
        <ViewportCenterOnResize controlsRef={controlsRef} sceneRadius={sceneScale * 0.5} enabled={frames.length > 1} />
        <group>
          {renderCutPoints.length > 1 && <Line points={renderCutPoints} color={lineColor} lineWidth={1.8} segments />}
          {showRapidPath && renderRapidPoints.length > 1 && (
            <Line
              points={renderRapidPoints}
              color="#94a3b8"
              lineWidth={1.2}
              segments
              dashed={renderRapidPoints.length < 7000}
              dashScale={2.2}
              gapSize={0.9}
            />
          )}
          {renderUvwPoints.length > 1 && (
            <Line points={renderUvwPoints} color="#a855f7" lineWidth={1.8} segments />
          )}
          {renderPlungePoints.length > 1 && (
            <Line points={renderPlungePoints} color="#facc15" lineWidth={1.8} segments />
          )}

          <FocusSegment points={focusSegment} lineWidth={focusWidth} />
          <ToolPoint segment={focusSegment} sceneScale={sceneScale} />
        </group>
        <RayPickController
          sampledSegments={sampledPickSegments}
          fullSegments={fullPickSegments}
          cutSegments={segmentData.cutSegments}
          rapidSegments={showRapidPath ? segmentData.rapidSegments : []}
          enabled
          sceneScale={sceneScale}
          focusCenter={geometryCenter}
          onHoverStateChange={setIsPickTargetHovered}
          onHoverSegment={(seg, x, y) => {
            onFrameHover?.(seg.endFrame);
            queueHoverTooltip(seg, x, y);
          }}
          onPickSegment={(seg, x, y) => {
            setPickedSegment(seg);
            onFramePick?.(seg.endFrame);
            if (showPathTooltip) setHoverTooltip({ segment: seg, x, y });
          }}
          onHoverEnd={() => {
            onFrameHoverEnd?.();
            clearHoverTooltip();
          }}
        />

        <OrbitControls
          ref={controlsRef}
          makeDefault
          enabled
          enablePan
          enableRotate
          enableZoom
          enableDamping={false}
          dampingFactor={0}
          rotateSpeed={1.6}
          panSpeed={1.0}
          zoomSpeed={0.9}
          minPolarAngle={0.0001}
          maxPolarAngle={Math.PI - 0.0001}
          minAzimuthAngle={-Infinity}
          maxAzimuthAngle={Infinity}
          screenSpacePanning
          mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }}
          onChange={() => {
            if (!onCameraStateChange || !controlsRef.current) return;
            if (cameraEmitRafRef.current !== null) return;
            cameraEmitRafRef.current = window.requestAnimationFrame(() => {
              cameraEmitRafRef.current = null;
              const controls = controlsRef.current;
              if (!controls) return;
              onCameraStateChange({
                target: {
                  x: controls.target.x,
                  y: controls.target.y,
                  z: controls.target.z,
                },
                position: {
                  x: controls.object.position.x,
                  y: controls.object.position.y,
                  z: controls.object.position.z,
                },
                zoom: 1,
                viewName: cameraState?.viewName ?? "Custom",
              });
            });
          }}
        />
      </Canvas>
      {showPathTooltip && hoverTooltip && hoverInfo && (
        <div
          className="path-hover-tooltip"
          style={{ left: hoverTooltip.x + 12, top: hoverTooltip.y + 12 }}
        >
          <div className="path-hover-row"><b>{t("hoverWords")}:</b></div>
          <div className="path-token-list">
            {hoverInfo.words.map((w, idx) => (
              <span key={`${w.letter}-${w.value}-${idx}`} className={`path-token token-${w.letter.toLowerCase()}`}>
                <b>{w.letter}</b>
                {w.value}
              </span>
            ))}
          </div>
          <div className="path-hover-row"><b>{t("hoverLineNo")}:</b> {hoverInfo.line}</div>
          <div className="path-hover-row"><b>{t("hoverType")}:</b> {hoverInfo.isCurve ? t("hoverCurve") : t("hoverLine")}</div>
          <div className="path-hover-row"><b>{t("hoverMotion")}:</b> {hoverInfo.motionLabel}</div>
          <div className="path-hover-row">
            <b>{t("hoverStart")}:</b> {hoverInfo.start.x.toFixed(3)}, {hoverInfo.start.y.toFixed(3)}, {hoverInfo.start.z.toFixed(3)}
          </div>
          <div className="path-hover-row">
            <b>{t("hoverEnd")}:</b> {hoverInfo.end.x.toFixed(3)}, {hoverInfo.end.y.toFixed(3)}, {hoverInfo.end.z.toFixed(3)}
          </div>
          {hoverInfo.isCurve ? (
            <>
              <div className="path-hover-row"><b>{t("hoverChord")}:</b> {hoverInfo.chord.toFixed(3)}</div>
              <div className="path-hover-row"><b>{t("hoverLength")}:</b> {hoverInfo.length.toFixed(3)}</div>
            </>
          ) : (
            <>
              <div className="path-hover-row"><b>{t("hoverAngle")}:</b> {hoverInfo.angleXY.toFixed(2)} deg</div>
              <div className="path-hover-row"><b>{t("hoverLength")}:</b> {hoverInfo.length.toFixed(3)}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

