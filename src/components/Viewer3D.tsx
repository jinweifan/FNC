import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, Line, OrbitControls } from "@react-three/drei";
import { Group, MOUSE, Quaternion, Raycaster, Vector2, Vector3 } from "three";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { PerspectiveCamera } from "three";
import type { CameraState, FrameState } from "../types";
import { resolveViewerFocusSegment } from "../lib/viewerFocusSegment";
import { asDreiLinePoints, buildLinePointBuffer } from "../lib/viewerLinePoints";
import { findClosestScreenSpaceSegment } from "../lib/viewerPick";
import { areViewer3DPropsEqual, type Viewer3DProps } from "../lib/viewer3dProps";
import { buildViewerSegmentData, type SegmentRecord } from "../lib/viewerSegments";

type Vec3Like = { x: number; y: number; z: number };
type HoverTooltipData = {
  segment: SegmentRecord;
  x: number;
  y: number;
};
type NcWord = {
  letter: string;
  value: string;
};

function isFiniteNumber(v: number): boolean {
  return Number.isFinite(v);
}

function isFiniteVec3Like(v: Vec3Like): boolean {
  return isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.z);
}

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

function clampPitchAwayFromPole(offset: Vector3, rightAxis: Vector3, desiredPitch: number): number {
  if (Math.abs(desiredPitch) < 1e-8) return 0;
  const worldUp = new Vector3(0, 0, 1);
  const tmp = offset.clone();
  const tryApply = (pitch: number) => {
    const q = new Quaternion().setFromAxisAngle(rightAxis, pitch);
    tmp.copy(offset).applyQuaternion(q);
    const forward = tmp.normalize().negate();
    return Math.abs(forward.dot(worldUp));
  };
  const poleLimit = 0.9985; // keep away from singularity at 1.0
  if (tryApply(desiredPitch) <= poleLimit) return desiredPitch;
  let lo = 0;
  let hi = Math.abs(desiredPitch);
  const sign = desiredPitch >= 0 ? 1 : -1;
  for (let i = 0; i < 14; i += 1) {
    const mid = (lo + hi) * 0.5;
    if (tryApply(mid * sign) <= poleLimit) lo = mid;
    else hi = mid;
  }
  return lo * sign;
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
  focusCenter,
  enabled,
  fitScale = 1.14,
}: {
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>;
  sceneRadius: number;
  focusCenter: Vec3Like;
  enabled: boolean;
  fitScale?: number;
}) {
  const { camera, size } = useThree();

  useEffect(() => {
    if (!enabled || !controlsRef.current || size.width <= 0 || size.height <= 0) return;

    const controls = controlsRef.current;
    if (!isFiniteVec3Like(focusCenter)) return;
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
    const fitDistance = Math.max(120, Math.max(distV, distH) * fitScale);
    if (!isFiniteNumber(fitDistance)) return;

    const target = new Vector3(focusCenter.x, focusCenter.y, focusCenter.z);
    camera.position.copy(target.clone().add(dir.multiplyScalar(fitDistance)));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    controls.target.copy(target);
    controls.update();
  }, [camera, controlsRef, enabled, fitScale, focusCenter.x, focusCenter.y, focusCenter.z, sceneRadius, size.height, size.width]);

  return null;
}

function ProgrammaticTopRefocus({
  controlsRef,
  sceneRadius,
  focusCenter,
  nonce,
  enabled,
  fitScale = 0.98,
  onApplied,
  onDone,
}: {
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>;
  sceneRadius: number;
  focusCenter: Vec3Like;
  nonce: number;
  enabled: boolean;
  fitScale?: number;
  onApplied?: (state: CameraState) => void;
  onDone?: () => void;
}) {
  const { camera, size } = useThree();
  const lastAppliedNonceRef = useRef<number>(0);

  useLayoutEffect(() => {
    if (!enabled || nonce <= 0) return;
    if (lastAppliedNonceRef.current === nonce) return;
    if (!controlsRef.current || size.width <= 0 || size.height <= 0) return;
    if (!isFiniteVec3Like(focusCenter)) return;

    const controls = controlsRef.current;
    const cam = camera as PerspectiveCamera;
    const vFov = ((cam.fov ?? 55) * Math.PI) / 180;
    const aspect = Math.max(0.1, size.width / Math.max(1, size.height));
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const radius = Math.max(1, sceneRadius);
    const distV = radius / Math.sin(Math.max(0.1, vFov / 2));
    const distH = radius / Math.sin(Math.max(0.1, hFov / 2));
    const fitDistance = Math.max(120, Math.max(distV, distH) * fitScale);
    if (!isFiniteNumber(fitDistance)) return;

    const target = new Vector3(focusCenter.x, focusCenter.y, focusCenter.z);
    cam.position.set(target.x, target.y, target.z + fitDistance);
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    controls.target.copy(target);
    controls.update();
    lastAppliedNonceRef.current = nonce;

    onApplied?.({
      target: { x: target.x, y: target.y, z: target.z },
      position: { x: target.x, y: target.y, z: target.z + fitDistance },
      zoom: 1,
      viewName: "Top",
    });
    onDone?.();
  }, [camera, controlsRef, enabled, fitScale, focusCenter.x, focusCenter.y, focusCenter.z, nonce, onApplied, onDone, sceneRadius, size.height, size.width]);

  return null;
}

function GlobeOrientationGizmo({
  controlsRef,
  theme,
  onAxisClick,
}: {
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>;
  theme: "light" | "navy" | "dark";
  onAxisClick?: (axis: "X" | "Y" | "Z") => void;
}) {
  const groupRef = useRef<Group | null>(null);
  const inv = useMemo(() => new Quaternion(), []);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls || !groupRef.current) return;
    inv.copy(controls.object.quaternion).invert();
    groupRef.current.quaternion.copy(inv);
  });

  const isLight = theme === "light";
  const sphereColor = isLight ? "#f8fafc" : theme === "navy" ? "#0f172a" : "#1f2937";
  const wireColor = isLight ? "#94a3b8" : theme === "navy" ? "#38bdf8" : "#60a5fa";
  const ringColor = isLight ? "#cbd5e1" : theme === "navy" ? "#334155" : "#374151";

  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight intensity={0.9} position={[2, 3, 4]} />
      <group ref={groupRef}>
        <mesh>
          <sphereGeometry args={[1, 32, 32]} />
          <meshStandardMaterial color={sphereColor} metalness={0.2} roughness={0.45} transparent opacity={0.94} />
        </mesh>
        <mesh>
          <sphereGeometry args={[1.01, 20, 20]} />
          <meshBasicMaterial color={wireColor} wireframe transparent opacity={0.32} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.08, 0.015, 12, 80]} />
          <meshBasicMaterial color={ringColor} transparent opacity={0.56} />
        </mesh>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[1.08, 0.015, 12, 80]} />
          <meshBasicMaterial color={ringColor} transparent opacity={0.56} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[1.08, 0.015, 12, 80]} />
          <meshBasicMaterial color={ringColor} transparent opacity={0.56} />
        </mesh>
        <arrowHelper args={[new Vector3(1, 0, 0), new Vector3(0, 0, 0), 1.6, 0xef4444, 0.24, 0.12]} />
        <arrowHelper args={[new Vector3(0, 1, 0), new Vector3(0, 0, 0), 1.6, 0x22c55e, 0.24, 0.12]} />
        <arrowHelper args={[new Vector3(0, 0, 1), new Vector3(0, 0, 0), 1.6, 0x3b82f6, 0.24, 0.12]} />
        <mesh
          position={[1.72, 0, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onAxisClick?.("X");
          }}
        >
          <sphereGeometry args={[0.14, 20, 20]} />
          <meshBasicMaterial color="#ef4444" />
        </mesh>
        <mesh
          position={[0, 1.72, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onAxisClick?.("Y");
          }}
        >
          <sphereGeometry args={[0.14, 20, 20]} />
          <meshBasicMaterial color="#22c55e" />
        </mesh>
        <mesh
          position={[0, 0, 1.72]}
          onClick={(e) => {
            e.stopPropagation();
            onAxisClick?.("Z");
          }}
        >
          <sphereGeometry args={[0.14, 20, 20]} />
          <meshBasicMaterial color="#3b82f6" />
        </mesh>
      </group>
    </>
  );
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
    const pa = new Vector3();
    const pb = new Vector3();
    let rafId = 0;
    let pendingMove: { clientX: number; clientY: number } | null = null;
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
        const best = findClosestScreenSpaceSegment(fullSegments, mx, my, pxThresholdSq, (seg) => {
          pa.set(seg.start.x, seg.start.y, seg.start.z).project(camera);
          pb.set(seg.end.x, seg.end.y, seg.end.z).project(camera);
          if (!Number.isFinite(pa.x) || !Number.isFinite(pa.y) || !Number.isFinite(pb.x) || !Number.isFinite(pb.y)) {
            return {
              ax: Number.POSITIVE_INFINITY,
              ay: Number.POSITIVE_INFINITY,
              bx: Number.POSITIVE_INFINITY,
              by: Number.POSITIVE_INFINITY,
            };
          }
          return {
            ax: (pa.x * 0.5 + 0.5) * rect.width,
            ay: (-pa.y * 0.5 + 0.5) * rect.height,
            bx: (pb.x * 0.5 + 0.5) * rect.width,
            by: (-pb.y * 0.5 + 0.5) * rect.height,
          };
        });
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
      pendingMove = { clientX: e.clientX, clientY: e.clientY };
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

    const onPointerLeave = () => {
      pointerDown = false;
      onLeave();
    };
    dom.addEventListener("pointermove", onMove, { passive: true });
    dom.addEventListener("pointerleave", onPointerLeave, { passive: true });
    dom.addEventListener("pointerdown", onPointerDown, { passive: true });
    dom.addEventListener("pointerup", onPointerUp, { passive: true });
    return () => {
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerleave", onPointerLeave);
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

const MemoRayPickController = memo(RayPickController);

const StaticPathGroup = memo(function StaticPathGroup({
  renderCutPoints,
  renderRapidPoints,
  renderUvwPoints,
  renderPlungePoints,
  showRapidPath,
  lineColor,
}: {
  renderCutPoints: number[];
  renderRapidPoints: number[];
  renderUvwPoints: number[];
  renderPlungePoints: number[];
  showRapidPath: boolean;
  lineColor: string;
}) {
  return (
    <group>
      {renderCutPoints.length > 1 && <Line points={asDreiLinePoints(renderCutPoints)} color={lineColor} lineWidth={1.8} segments />}
      {showRapidPath && renderRapidPoints.length > 1 && (
        <Line
          points={asDreiLinePoints(renderRapidPoints)}
          color="#94a3b8"
          lineWidth={1.2}
          segments
          dashed={renderRapidPoints.length < 7000}
          dashScale={2.2}
          gapSize={0.9}
        />
      )}
      {renderUvwPoints.length > 1 && (
        <Line points={asDreiLinePoints(renderUvwPoints)} color="#a855f7" lineWidth={1.8} segments />
      )}
      {renderPlungePoints.length > 1 && (
        <Line points={asDreiLinePoints(renderPlungePoints)} color="#facc15" lineWidth={1.8} segments />
      )}
    </group>
  );
});

const FocusOverlay = memo(function FocusOverlay({
  focusSegment,
  focusWidth,
  sceneScale,
}: {
  focusSegment: Vector3[] | null;
  focusWidth: number;
  sceneScale: number;
}) {
  return (
    <>
      <FocusSegment points={focusSegment} lineWidth={focusWidth} />
      <ToolPoint segment={focusSegment} sceneScale={sceneScale} />
    </>
  );
});

function Viewer3DInner({
  frames,
  codeLines,
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
  showOrientationGizmo = true,
  refocusNonce = 0,
  onRefocusApplied,
  fitOnResize = true,
  onRequestNamedView,
}: Viewer3DProps) {
  const { t } = useTranslation();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const [controlsReady, setControlsReady] = useState(false);
  const rotateDragRef = useRef<{ active: boolean; pointerId: number; lastX: number; lastY: number }>({
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
  });
  const rotateRightAxisRef = useRef<Vector3>(new Vector3(1, 0, 0));
  const rotateDeltaRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const rotateRafRef = useRef<number>(0);
  const gizmoDragRef = useRef<{ active: boolean; pointerId: number; lastX: number; lastY: number }>({
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
  });
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
  const normalizedCodeLines = codeLines ?? [];
  const segmentData = useMemo(
    () => buildViewerSegmentData(frames, normalizedCodeLines),
    [frames, normalizedCodeLines],
  );
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
    () => {
      const maxSegs = isPointerDown ? scaledCount(9000, 1800) : scaledCount(28000, 3200);
      return buildLinePointBuffer(segmentData.cutRenderSegments, maxSegs);
    },
    [isPointerDown, scaledCount, segmentData.cutRenderSegments],
  );
  const renderPlungePoints = useMemo(
    () => {
      return buildLinePointBuffer(segmentData.plungeRenderSegments);
    },
    [segmentData.plungeRenderSegments],
  );
  const renderUvwPoints = useMemo(
    () => {
      const maxSegs = isPointerDown ? scaledCount(7000, 1400) : scaledCount(22000, 2800);
      return buildLinePointBuffer(segmentData.uvwRenderSegments, maxSegs);
    },
    [isPointerDown, scaledCount, segmentData.uvwRenderSegments],
  );
  const renderRapidPoints = useMemo(
    () => {
      const maxSegs = isPointerDown ? scaledCount(6000, 1000) : scaledCount(18000, 2400);
      return buildLinePointBuffer(segmentData.rapidRenderSegments, maxSegs);
    },
    [isPointerDown, scaledCount, segmentData.rapidRenderSegments],
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
      if (!isFiniteVec3Like(f.position)) continue;
      minX = Math.min(minX, f.position.x);
      minY = Math.min(minY, f.position.y);
      minZ = Math.min(minZ, f.position.z);
      maxX = Math.max(maxX, f.position.x);
      maxY = Math.max(maxY, f.position.y);
      maxZ = Math.max(maxZ, f.position.z);
    }
    if (
      !isFiniteNumber(minX) || !isFiniteNumber(minY) || !isFiniteNumber(minZ) ||
      !isFiniteNumber(maxX) || !isFiniteNumber(maxY) || !isFiniteNumber(maxZ)
    ) {
      return 100;
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
      if (!isFiniteVec3Like(f.position)) continue;
      minX = Math.min(minX, f.position.x);
      minY = Math.min(minY, f.position.y);
      minZ = Math.min(minZ, f.position.z);
      maxX = Math.max(maxX, f.position.x);
      maxY = Math.max(maxY, f.position.y);
      maxZ = Math.max(maxZ, f.position.z);
    }
    if (
      !isFiniteNumber(minX) || !isFiniteNumber(minY) || !isFiniteNumber(minZ) ||
      !isFiniteNumber(maxX) || !isFiniteNumber(maxY) || !isFiniteNumber(maxZ)
    ) {
      return new Vector3(0, 0, 0);
    }
    return new Vector3((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
  }, [centerFrames]);
  const markerFrame = currentFrame ?? hoverFrame ?? null;

  const focusSegment = useMemo(() => {
    const focusPoints = resolveViewerFocusSegment(frames, markerFrame, pickedSegment);
    if (!focusPoints) return null;
    return focusPoints.map((point) => new Vector3(point.x, point.y, point.z));
  }, [frames, markerFrame, pickedSegment]);

  const focusWidth = markerFrame?.motion === "Rapid" ? 1.2 : 1.8;
  const hoverInfo = useMemo(() => {
    if (!hoverTooltip) return null;
    const seg = hoverTooltip.segment;
    const dx = seg.end.x - seg.start.x;
    const dy = seg.end.y - seg.start.y;
    const dz = seg.end.z - seg.start.z;
    const length = Math.hypot(dx, dy, dz);
    const isCurve = seg.endFrame.motion === "ArcCw" || seg.endFrame.motion === "ArcCcw";
    const rawLine = normalizedCodeLines[Math.max(0, (seg.endFrame.lineNumber ?? 1) - 1)] ?? "";
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
  }, [hoverTooltip, normalizedCodeLines]);

  const queueHoverTooltip = useCallback((seg: SegmentRecord, clientX: number, clientY: number) => {
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
  }, [hoverTooltip, showPathTooltip]);

  const clearHoverTooltip = useCallback(() => {
    if (hoverDelayRef.current) window.clearTimeout(hoverDelayRef.current);
    hoverDelayRef.current = null;
    setHoverTooltip(null);
  }, []);

  const handleHoverSegment = useCallback((seg: SegmentRecord, x: number, y: number) => {
    onFrameHover?.(seg.endFrame);
    queueHoverTooltip(seg, x, y);
  }, [onFrameHover, queueHoverTooltip]);

  const handlePickSegment = useCallback((seg: SegmentRecord, x: number, y: number) => {
    setPickedSegment(seg);
    onFramePick?.(seg.endFrame);
    if (showPathTooltip) setHoverTooltip({ segment: seg, x, y });
  }, [onFramePick, showPathTooltip]);

  const handleHoverEnd = useCallback(() => {
    onFrameHoverEnd?.();
    clearHoverTooltip();
  }, [clearHoverTooltip, onFrameHoverEnd]);

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

  useLayoutEffect(() => {
    if (isPointerDown || rotateDragRef.current.active) return;
    if (!cameraState || !controlsRef.current || !controlsReady) return;
    if (!isFiniteVec3Like(cameraState.position) || !isFiniteVec3Like(cameraState.target)) return;
    const minDistance = Math.max(8, sceneScale * 0.03);
    const maxDistance = Math.max(400, sceneScale * 10);
    controlsRef.current.minDistance = minDistance;
    controlsRef.current.maxDistance = maxDistance;
    const sourcePos = new Vector3(
      cameraState.position.x,
      cameraState.position.y,
      cameraState.position.z,
    );
    const sourceTarget = new Vector3(cameraState.target.x, cameraState.target.y, cameraState.target.z);
    const absoluteTarget = sourceTarget;
    const dir = new Vector3().subVectors(sourcePos, sourceTarget);
    // Keep camera distance consistent with OrbitControls limits only.
    // Using a larger custom floor here causes zoom fight/jitter.
    const distance = Math.min(maxDistance, Math.max(minDistance, dir.length()));
    const absolutePos = absoluteTarget.clone().add(
      (dir.lengthSq() > 1e-8 ? dir.normalize() : new Vector3(0, 0, 1)).multiplyScalar(distance),
    );
    const curPos = controlsRef.current.object.position;
    const curTarget = controlsRef.current.target;
    const isAlreadyApplied =
      curPos.distanceToSquared(absolutePos) < 1e-8 &&
      curTarget.distanceToSquared(absoluteTarget) < 1e-8;
    if (isAlreadyApplied) return;
    controlsRef.current.object.position.copy(absolutePos);
    const forward = new Vector3().subVectors(absoluteTarget, absolutePos).normalize();
    const nearTopOrBottom = Math.abs(forward.dot(new Vector3(0, 0, 1))) > 0.985;
    // For strict top/bottom views, avoid up-vector singularity.
    controlsRef.current.object.up.set(0, nearTopOrBottom ? 1 : 0, nearTopOrBottom ? 0 : 1);
    controlsRef.current.target.copy(absoluteTarget);
    controlsRef.current.object.lookAt(
      absoluteTarget.x,
      absoluteTarget.y,
      absoluteTarget.z,
    );
    controlsRef.current.object.updateProjectionMatrix();
    controlsRef.current.update();
  }, [cameraState, controlsReady, isPointerDown, sceneScale]);

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

  const applyFreeRotate = useCallback((dx: number, dy: number) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const cam = controls.object as PerspectiveCamera;
    const target = controls.target.clone();
    const offset = cam.position.clone().sub(target);
    if (offset.lengthSq() < 1e-10) return;

    const yaw = -dx * 0.0082;
    const rawPitch = -dy * 0.0082;
    const worldUp = new Vector3(0, 0, 1);

    // Yaw around global Z to keep azimuth stable.
    if (Math.abs(yaw) > 1e-7) {
      const qYaw = new Quaternion().setFromAxisAngle(worldUp, yaw);
      offset.applyQuaternion(qYaw);
    }

    // Pitch around view-right axis derived from current orbit offset (stable near poles).
    const forward = offset.clone().normalize().negate();
    let right = new Vector3().crossVectors(forward, worldUp);
    if (right.lengthSq() < 1e-10) {
      right.copy(rotateRightAxisRef.current);
    } else {
      right.normalize();
      rotateRightAxisRef.current.copy(right);
    }
    const pitch = right.lengthSq() > 1e-10
      ? clampPitchAwayFromPole(offset, right, rawPitch)
      : 0;
    if (Math.abs(pitch) > 1e-7 && right.lengthSq() > 1e-10) {
      const qPitch = new Quaternion().setFromAxisAngle(right, pitch);
      offset.applyQuaternion(qPitch);
    }

    cam.position.copy(target.clone().add(offset));
    // Keep a stable world-up to avoid camera up-vector oscillation near pole.
    cam.up.set(0, 0, 1);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    controls.update();
  }, []);

  const stopRotateLoop = useCallback(() => {
    if (rotateRafRef.current) {
      window.cancelAnimationFrame(rotateRafRef.current);
      rotateRafRef.current = 0;
    }
    rotateDeltaRef.current.dx = 0;
    rotateDeltaRef.current.dy = 0;
  }, []);

  const startRotateLoop = useCallback(() => {
    if (rotateRafRef.current) return;
    const tick = () => {
      rotateRafRef.current = 0;
      const { dx, dy } = rotateDeltaRef.current;
      const hasDelta = Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001;
      if (hasDelta) {
        const stepX = dx * 0.72;
        const stepY = dy * 0.72;
        rotateDeltaRef.current.dx -= stepX;
        rotateDeltaRef.current.dy -= stepY;
        applyFreeRotate(stepX, stepY);
      }
      if (
        rotateDragRef.current.active ||
        Math.abs(rotateDeltaRef.current.dx) > 0.001 ||
        Math.abs(rotateDeltaRef.current.dy) > 0.001
      ) {
        rotateRafRef.current = window.requestAnimationFrame(tick);
      }
    };
    rotateRafRef.current = window.requestAnimationFrame(tick);
  }, [applyFreeRotate]);

  useEffect(() => {
    const resetRotateState = () => {
      let changed = false;
      if (rotateDragRef.current.active) {
        rotateDragRef.current.active = false;
        rotateDragRef.current.pointerId = -1;
        if (controlsRef.current) controlsRef.current.enabled = true;
        changed = true;
      }
      if (gizmoDragRef.current.active) {
        gizmoDragRef.current.active = false;
        gizmoDragRef.current.pointerId = -1;
        changed = true;
      }
      if (!changed) return;
      setIsPointerDown(false);
      stopRotateLoop();
    };
    window.addEventListener("pointerup", resetRotateState);
    window.addEventListener("pointercancel", resetRotateState);
    window.addEventListener("blur", resetRotateState);
    return () => {
      window.removeEventListener("pointerup", resetRotateState);
      window.removeEventListener("pointercancel", resetRotateState);
      window.removeEventListener("blur", resetRotateState);
      stopRotateLoop();
    };
  }, [stopRotateLoop]);

  const emitCameraState = useCallback((viewName: CameraState["viewName"] = "Custom") => {
    if (!onCameraStateChange || !controlsRef.current) return;
    const controls = controlsRef.current;
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
      viewName,
    });
  }, [onCameraStateChange]);


  return (
    <div
      className={`viewer-canvas-wrap mode-${interactionMode}${isPointerDown ? " dragging" : ""}${isPickTargetHovered ? " pick-hover" : ""}`}
      tabIndex={0}
      onPointerDownCapture={(e) => {
        if (e.button !== 2) return;
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLDivElement).focus();
        onViewerHotkeyScopeChange?.(true);
        setIsPointerDown(true);
        rotateDragRef.current = {
          active: true,
          pointerId: e.pointerId,
          lastX: e.clientX,
          lastY: e.clientY,
        };
        rotateDeltaRef.current.dx = 0;
        rotateDeltaRef.current.dy = 0;
        if (controlsRef.current) controlsRef.current.enabled = false;
        try {
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        } catch {
          // noop
        }
      }}
      onPointerMoveCapture={(e) => {
        if (!rotateDragRef.current.active || rotateDragRef.current.pointerId !== e.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        if ((e.buttons & 2) === 0) {
          rotateDragRef.current.active = false;
          rotateDragRef.current.pointerId = -1;
          if (controlsRef.current) controlsRef.current.enabled = true;
          setIsPointerDown(false);
          stopRotateLoop();
          return;
        }
        const dx = e.clientX - rotateDragRef.current.lastX;
        const dy = e.clientY - rotateDragRef.current.lastY;
        rotateDragRef.current.lastX = e.clientX;
        rotateDragRef.current.lastY = e.clientY;
        rotateDeltaRef.current.dx += dx;
        rotateDeltaRef.current.dy += dy;
        startRotateLoop();
      }}
      onPointerUpCapture={(e) => {
        if (!rotateDragRef.current.active || rotateDragRef.current.pointerId !== e.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        rotateDragRef.current.active = false;
        rotateDragRef.current.pointerId = -1;
        if (controlsRef.current) controlsRef.current.enabled = true;
        setIsPointerDown(false);
        stopRotateLoop();
        try {
          (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        } catch {
          // noop
        }
        if (onCameraStateChange && controlsRef.current) emitCameraState("Custom");
      }}
      onPointerDown={(e) => {
        setIsPointerDown(true);
        // Keyboard shortcuts should only be active when the 3D viewport is focused.
        (e.currentTarget as HTMLDivElement).focus();
        onViewerHotkeyScopeChange?.(true);
      }}
      onPointerMove={(e) => {
        if (rotateDragRef.current.active && rotateDragRef.current.pointerId === e.pointerId) return;
      }}
      onPointerUp={(e) => {
        if (rotateDragRef.current.active && rotateDragRef.current.pointerId === e.pointerId) return;
        setIsPointerDown(false);
        if (rotateDragRef.current.active && rotateDragRef.current.pointerId === e.pointerId) {
          e.stopPropagation();
          rotateDragRef.current.active = false;
          rotateDragRef.current.pointerId = -1;
          if (controlsRef.current) controlsRef.current.enabled = true;
          try {
            (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
          } catch {
            // noop
          }
        }
        if (onCameraStateChange && controlsRef.current) emitCameraState("Custom");
      }}
      onPointerCancel={(e) => {
        setIsPointerDown(false);
        if (rotateDragRef.current.active && rotateDragRef.current.pointerId === e.pointerId) {
          rotateDragRef.current.active = false;
          rotateDragRef.current.pointerId = -1;
          if (controlsRef.current) controlsRef.current.enabled = true;
          stopRotateLoop();
        }
      }}
      onFocus={() => onViewerHotkeyScopeChange?.(true)}
      onBlur={() => onViewerHotkeyScopeChange?.(false)}
      onPointerLeave={() => {
        setIsPointerDown(false);
        if (rotateDragRef.current.active) {
          rotateDragRef.current.active = false;
          rotateDragRef.current.pointerId = -1;
          if (controlsRef.current) controlsRef.current.enabled = true;
          stopRotateLoop();
        }
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
        <ViewportCenterOnResize
          controlsRef={controlsRef}
          sceneRadius={sceneScale * 0.5}
          focusCenter={geometryCenter}
          enabled={fitOnResize && frames.length > 1}
          fitScale={0.98}
        />
        <ProgrammaticTopRefocus
          controlsRef={controlsRef}
          sceneRadius={sceneScale * 0.5}
          focusCenter={geometryCenter}
          nonce={refocusNonce}
          enabled={frames.length > 1}
          fitScale={0.98}
          onApplied={onCameraStateChange}
          onDone={onRefocusApplied}
        />
        <StaticPathGroup
          renderCutPoints={renderCutPoints}
          renderRapidPoints={renderRapidPoints}
          renderUvwPoints={renderUvwPoints}
          renderPlungePoints={renderPlungePoints}
          showRapidPath={showRapidPath}
          lineColor={lineColor}
        />
        <FocusOverlay focusSegment={focusSegment} focusWidth={focusWidth} sceneScale={sceneScale} />
        <MemoRayPickController
          sampledSegments={sampledPickSegments}
          fullSegments={fullPickSegments}
          cutSegments={segmentData.cutSegments}
          rapidSegments={showRapidPath ? segmentData.rapidSegments : []}
          enabled={!isPointerDown}
          sceneScale={sceneScale}
          focusCenter={geometryCenter}
          onHoverStateChange={setIsPickTargetHovered}
          onHoverSegment={handleHoverSegment}
          onPickSegment={handlePickSegment}
          onHoverEnd={handleHoverEnd}
        />

        <OrbitControls
          ref={(ctrl) => {
            controlsRef.current = ctrl;
            if (ctrl && !controlsReady) setControlsReady(true);
            if (ctrl && cameraState && isFiniteVec3Like(cameraState.position) && isFiniteVec3Like(cameraState.target)) {
              const absolutePos = new Vector3(
                cameraState.position.x,
                cameraState.position.y,
                cameraState.position.z,
              );
              const absoluteTarget = new Vector3(
                cameraState.target.x,
                cameraState.target.y,
                cameraState.target.z,
              );
              ctrl.object.position.copy(absolutePos);
              const forward = new Vector3().subVectors(absoluteTarget, absolutePos).normalize();
              const nearTopOrBottom = Math.abs(forward.dot(new Vector3(0, 0, 1))) > 0.985;
              ctrl.object.up.set(0, nearTopOrBottom ? 1 : 0, nearTopOrBottom ? 0 : 1);
              ctrl.target.copy(absoluteTarget);
              ctrl.object.lookAt(absoluteTarget);
              ctrl.object.updateProjectionMatrix();
              ctrl.update();
            }
          }}
          makeDefault
          enabled
          enablePan
          enableRotate={false}
          enableZoom
          enableDamping={false}
          dampingFactor={0}
          rotateSpeed={2.35}
          panSpeed={1.0}
          zoomSpeed={0.9}
          minPolarAngle={0}
          maxPolarAngle={Math.PI}
          minAzimuthAngle={-Infinity}
          maxAzimuthAngle={Infinity}
          screenSpacePanning
          mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }}
          onEnd={() => {
            emitCameraState("Custom");
          }}
        />
      </Canvas>
      {showOrientationGizmo && (
        <div
          className={`viewer-orient-gizmo viewer-orient-${theme}`}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            gizmoDragRef.current = {
              active: true,
              pointerId: e.pointerId,
              lastX: e.clientX,
              lastY: e.clientY,
            };
            setIsPointerDown(true);
            try {
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            } catch {
              // noop
            }
          }}
          onPointerMove={(e) => {
            if (!gizmoDragRef.current.active || gizmoDragRef.current.pointerId !== e.pointerId) return;
            e.preventDefault();
            e.stopPropagation();
            const dx = e.clientX - gizmoDragRef.current.lastX;
            const dy = e.clientY - gizmoDragRef.current.lastY;
            gizmoDragRef.current.lastX = e.clientX;
            gizmoDragRef.current.lastY = e.clientY;
            rotateDeltaRef.current.dx += dx;
            rotateDeltaRef.current.dy += dy;
            startRotateLoop();
          }}
          onPointerUp={(e) => {
            if (!gizmoDragRef.current.active || gizmoDragRef.current.pointerId !== e.pointerId) return;
            e.preventDefault();
            e.stopPropagation();
            gizmoDragRef.current.active = false;
            gizmoDragRef.current.pointerId = -1;
            setIsPointerDown(false);
            try {
              (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
            } catch {
              // noop
            }
            if (onCameraStateChange && controlsRef.current) emitCameraState("Custom");
          }}
          onPointerCancel={(e) => {
            if (!gizmoDragRef.current.active || gizmoDragRef.current.pointerId !== e.pointerId) return;
            gizmoDragRef.current.active = false;
            gizmoDragRef.current.pointerId = -1;
            setIsPointerDown(false);
          }}
        >
          <Canvas
            orthographic
            camera={{ position: [0, 0, 5.2], zoom: 50 }}
            gl={{ antialias: true, alpha: true }}
            dpr={[1, 1.5]}
          >
            <GlobeOrientationGizmo
              controlsRef={controlsRef}
              theme={theme}
              onAxisClick={(axis) => {
                if (axis === "X") onRequestNamedView?.("Right");
                if (axis === "Y") onRequestNamedView?.("Front");
                if (axis === "Z") onRequestNamedView?.("Top");
              }}
            />
          </Canvas>
        </div>
      )}
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

export const Viewer3D = memo(Viewer3DInner, areViewer3DPropsEqual);
