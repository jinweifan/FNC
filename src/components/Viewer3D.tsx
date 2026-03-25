import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, Line, OrbitControls } from "@react-three/drei";
import { Group, MOUSE, Quaternion, Raycaster, Vector2, Vector3 } from "three";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type WheelEvent as ReactWheelEvent } from "react";
import { useTranslation } from "react-i18next";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { PerspectiveCamera } from "three";
import type { CameraState } from "../types";
import { resolveViewerFocusPointBuffer } from "../lib/viewerFocusSegment";
import { getGizmoAxisMaterialProps, getGizmoHaloMaterialProps } from "../lib/viewerGizmoLayers";
import { buildViewerHoverInfo } from "../lib/viewerHoverInfo";
import { asDreiLinePoints } from "../lib/viewerLinePoints";
import { getViewerSourceSignature, isSegmentRecordStale } from "../lib/viewerPlaybackState";
import { findClosestScreenSpaceSegment } from "../lib/viewerPick";
import { areViewer3DPropsEqual, type Viewer3DProps } from "../lib/viewer3dProps";
import { type SegmentRecord } from "../lib/viewerSegments";
import { buildViewerPickCollections, buildViewerRenderBuffers, buildViewerSceneData } from "../lib/viewerSceneData";
import { computeAnchoredZoomState } from "../lib/viewerZoom";

type Vec3Like = { x: number; y: number; z: number };
type HoverTooltipData = {
  segment: SegmentRecord;
  x: number;
  y: number;
};

function isFiniteNumber(v: number): boolean {
  return Number.isFinite(v);
}

function isFiniteVec3Like(v: Vec3Like): boolean {
  return isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.z);
}

function FocusSegment({
  points,
  lineWidth,
}: {
  points: number[] | null;
  lineWidth: number;
}) {
  if (!points || points.length < 6) return null;
  return (
    <Line
      points={asDreiLinePoints(points)}
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
  segment: number[] | null;
  sceneScale: number;
}) {
  if (!segment || segment.length < 6) return null;
  const endOffset = segment.length - 3;
  const startOffset = segment.length - 6;
  const dir = new Vector3(
    segment[endOffset] - segment[startOffset],
    segment[endOffset + 1] - segment[startOffset + 1],
    segment[endOffset + 2] - segment[startOffset + 2],
  );
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
    segment[endOffset] - dir.x * arrowLen,
    segment[endOffset + 1] - dir.y * arrowLen,
    segment[endOffset + 2] - dir.z * arrowLen,
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
  const haloMaterialProps = getGizmoHaloMaterialProps();
  const axisMaterialProps = getGizmoAxisMaterialProps();

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
          <meshBasicMaterial color={ringColor} opacity={0.56} {...haloMaterialProps} />
        </mesh>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[1.08, 0.015, 12, 80]} />
          <meshBasicMaterial color={ringColor} opacity={0.56} {...haloMaterialProps} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[1.08, 0.015, 12, 80]} />
          <meshBasicMaterial color={ringColor} opacity={0.56} {...haloMaterialProps} />
        </mesh>
        <arrowHelper
          args={[new Vector3(1, 0, 0), new Vector3(0, 0, 0), 1.6, 0xef4444, 0.24, 0.12]}
          renderOrder={axisMaterialProps.renderOrder}
        />
        <arrowHelper
          args={[new Vector3(0, 1, 0), new Vector3(0, 0, 0), 1.6, 0x22c55e, 0.24, 0.12]}
          renderOrder={axisMaterialProps.renderOrder}
        />
        <arrowHelper
          args={[new Vector3(0, 0, 1), new Vector3(0, 0, 0), 1.6, 0x3b82f6, 0.24, 0.12]}
          renderOrder={axisMaterialProps.renderOrder}
        />
        <mesh
          position={[1.72, 0, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onAxisClick?.("X");
          }}
          renderOrder={axisMaterialProps.renderOrder}
        >
          <sphereGeometry args={[0.14, 20, 20]} />
          <meshBasicMaterial color="#ef4444" {...axisMaterialProps} />
        </mesh>
        <mesh
          position={[0, 1.72, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onAxisClick?.("Y");
          }}
          renderOrder={axisMaterialProps.renderOrder}
        >
          <sphereGeometry args={[0.14, 20, 20]} />
          <meshBasicMaterial color="#22c55e" {...axisMaterialProps} />
        </mesh>
        <mesh
          position={[0, 0, 1.72]}
          onClick={(e) => {
            e.stopPropagation();
            onAxisClick?.("Z");
          }}
          renderOrder={axisMaterialProps.renderOrder}
        >
          <sphereGeometry args={[0.14, 20, 20]} />
          <meshBasicMaterial color="#3b82f6" {...axisMaterialProps} />
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
  focusSegment: number[] | null;
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
  zoomRequestNonce = 0,
  zoomRequestScale = 1,
  refocusNonce = 0,
  onRefocusApplied,
  fitOnResize = true,
  onRequestNamedView,
}: Viewer3DProps) {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null);
  const lastHandledZoomRequestRef = useRef(0);
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
  const suppressExternalCameraSyncUntilRef = useRef(0);
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
  const sceneData = useMemo(
    () => buildViewerSceneData(frames, normalizedCodeLines),
    [frames, normalizedCodeLines],
  );
  const { segmentData, sceneScale, geometryCenter } = sceneData;
  const pickCollections = useMemo(
    () => buildViewerPickCollections(segmentData, showRapidPath, scaledCount),
    [scaledCount, segmentData, showRapidPath],
  );
  const renderBuffers = useMemo(
    () => buildViewerRenderBuffers(segmentData, isPointerDown, scaledCount),
    [isPointerDown, scaledCount, segmentData],
  );
  const renderCutPoints = renderBuffers.cutPoints;
  const renderPlungePoints = renderBuffers.plungePoints;
  const renderUvwPoints = renderBuffers.uvwPoints;
  const renderRapidPoints = renderBuffers.rapidPoints;
  const sourceSignature = useMemo(() => getViewerSourceSignature(frames), [frames]);
  const markerFrame = currentFrame ?? hoverFrame ?? null;

  const focusSegment = useMemo(() => {
    return resolveViewerFocusPointBuffer(frames, markerFrame, pickedSegment);
  }, [frames, markerFrame, pickedSegment]);

  const focusWidth = markerFrame?.motion === "Rapid" ? 1.2 : 1.8;
  const hoverInfo = useMemo(() => {
    if (!hoverTooltip) return null;
    const rawLine = normalizedCodeLines[Math.max(0, (hoverTooltip.segment.endFrame.lineNumber ?? 1) - 1)] ?? "";
    return buildViewerHoverInfo(hoverTooltip.segment, rawLine);
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
    clearHoverTooltip();
    setIsPickTargetHovered(false);
    setPickedSegment((prev) => (isSegmentRecordStale(prev, frames) ? null : prev));
  }, [clearHoverTooltip, frames, sourceSignature]);

  useEffect(() => {
    if (!pickedSegment || !currentFrame) return;
    const sameFrame =
      pickedSegment.endFrame.index === currentFrame.index &&
      pickedSegment.endFrame.lineNumber === currentFrame.lineNumber;
    if (!sameFrame) setPickedSegment(null);
  }, [currentFrame, pickedSegment]);

  useLayoutEffect(() => {
    if (isPointerDown || rotateDragRef.current.active) return;
    if (performance.now() < suppressExternalCameraSyncUntilRef.current) return;
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
    suppressExternalCameraSyncUntilRef.current = performance.now() + 180;
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

  const resolveZoomAnchor = useCallback((clientX?: number, clientY?: number) => {
    const controls = controlsRef.current;
    const host = wrapperRef.current;
    if (!controls || !host || clientX == null || clientY == null) {
      return {
        x: controls?.target.x ?? 0,
        y: controls?.target.y ?? 0,
        z: controls?.target.z ?? 0,
      };
    }

    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { x: controls.target.x, y: controls.target.y, z: controls.target.z };
    }
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const camera = controls.object as PerspectiveCamera;
    const toScreen = (point: { x: number; y: number; z: number }) => {
      const projected = new Vector3(point.x, point.y, point.z).project(camera);
      return {
        x: (projected.x * 0.5 + 0.5) * rect.width,
        y: (-projected.y * 0.5 + 0.5) * rect.height,
      };
    };

    const best = findClosestScreenSpaceSegment(pickCollections.fullSegments, mx, my, 40 * 40, (seg) => {
      const start = toScreen(seg.start);
      const end = toScreen(seg.end);
      if (!Number.isFinite(start.x) || !Number.isFinite(start.y) || !Number.isFinite(end.x) || !Number.isFinite(end.y)) {
        return {
          ax: Number.POSITIVE_INFINITY,
          ay: Number.POSITIVE_INFINITY,
          bx: Number.POSITIVE_INFINITY,
          by: Number.POSITIVE_INFINITY,
        };
      }
      return { ax: start.x, ay: start.y, bx: end.x, by: end.y };
    });

    if (!best) {
      return { x: controls.target.x, y: controls.target.y, z: controls.target.z };
    }

    const start = toScreen(best.start);
    const end = toScreen(best.end);
    const abx = end.x - start.x;
    const aby = end.y - start.y;
    const denom = abx * abx + aby * aby;
    const ratio = denom > 1e-8
      ? Math.max(0, Math.min(1, ((mx - start.x) * abx + (my - start.y) * aby) / denom))
      : 1;
    return {
      x: best.start.x + (best.end.x - best.start.x) * ratio,
      y: best.start.y + (best.end.y - best.start.y) * ratio,
      z: best.start.z + (best.end.z - best.start.z) * ratio,
    };
  }, [pickCollections.fullSegments]);

  const handleWheel = useCallback((e: ReactWheelEvent<HTMLDivElement>) => {
    const controls = controlsRef.current;
    if (!controls) return;

    e.preventDefault();
    e.stopPropagation();
    lastPointerClientRef.current = { x: e.clientX, y: e.clientY };

    const camera = controls.object as PerspectiveCamera;
    const anchor = resolveZoomAnchor(e.clientX, e.clientY);

    const next = computeAnchoredZoomState(
      {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      {
        x: controls.target.x,
        y: controls.target.y,
        z: controls.target.z,
      },
      anchor,
      e.deltaY < 0 ? 0.74 : 1.35,
      controls.minDistance || Math.max(8, sceneScale * 0.03),
      controls.maxDistance || Math.max(400, sceneScale * 10),
    );

    camera.position.set(next.position.x, next.position.y, next.position.z);
    controls.target.set(next.target.x, next.target.y, next.target.z);
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
    controls.update();
    emitCameraState("Custom");
  }, [emitCameraState, resolveZoomAnchor, sceneScale]);

  useEffect(() => {
    if (zoomRequestNonce <= 0 || zoomRequestNonce === lastHandledZoomRequestRef.current) return;
    lastHandledZoomRequestRef.current = zoomRequestNonce;
    const controls = controlsRef.current;
    if (!controls) return;
    const camera = controls.object as PerspectiveCamera;
    const pointer = lastPointerClientRef.current;
    const anchor = resolveZoomAnchor(pointer?.x, pointer?.y);
    const next = computeAnchoredZoomState(
      {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      {
        x: controls.target.x,
        y: controls.target.y,
        z: controls.target.z,
      },
      anchor,
      zoomRequestScale,
      controls.minDistance || Math.max(8, sceneScale * 0.03),
      controls.maxDistance || Math.max(400, sceneScale * 10),
    );
    camera.position.set(next.position.x, next.position.y, next.position.z);
    controls.target.set(next.target.x, next.target.y, next.target.z);
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
    controls.update();
    emitCameraState("Custom");
  }, [emitCameraState, resolveZoomAnchor, sceneScale, zoomRequestNonce, zoomRequestScale]);


  return (
    <div
      ref={wrapperRef}
      className={`viewer-canvas-wrap mode-${interactionMode}${isPointerDown ? " dragging" : ""}${isPickTargetHovered ? " pick-hover" : ""}`}
      tabIndex={0}
      onWheelCapture={handleWheel}
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
        lastPointerClientRef.current = { x: e.clientX, y: e.clientY };
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
        lastPointerClientRef.current = { x: e.clientX, y: e.clientY };
        setIsPointerDown(true);
        // Keyboard shortcuts should only be active when the 3D viewport is focused.
        (e.currentTarget as HTMLDivElement).focus();
        onViewerHotkeyScopeChange?.(true);
      }}
      onPointerMove={(e) => {
        lastPointerClientRef.current = { x: e.clientX, y: e.clientY };
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
          sampledSegments={pickCollections.sampledSegments}
          fullSegments={pickCollections.fullSegments}
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
          }}
          makeDefault
          enabled
          enablePan
          enableRotate={false}
          enableZoom={false}
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
