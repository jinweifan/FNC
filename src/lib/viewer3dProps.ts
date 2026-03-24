import type { CameraState, FrameState } from "../types";

export type Viewer3DProps = {
  frames: FrameState[];
  codeLines?: string[];
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
  showOrientationGizmo?: boolean;
  zoomRequestNonce?: number;
  zoomRequestScale?: number;
  refocusNonce?: number;
  onRefocusApplied?: () => void;
  fitOnResize?: boolean;
  onRequestNamedView?: (view: "Top" | "Front" | "Right") => void;
};

export function areViewer3DPropsEqual(prev: Viewer3DProps, next: Viewer3DProps): boolean {
  return (
    prev.frames === next.frames &&
    prev.codeLines === next.codeLines &&
    prev.currentFrame === next.currentFrame &&
    prev.hoverFrame === next.hoverFrame &&
    prev.cameraState === next.cameraState &&
    prev.onFramePick === next.onFramePick &&
    prev.onFrameHover === next.onFrameHover &&
    prev.onFrameHoverEnd === next.onFrameHoverEnd &&
    prev.onViewerHotkeyScopeChange === next.onViewerHotkeyScopeChange &&
    prev.onCameraStateChange === next.onCameraStateChange &&
    prev.theme === next.theme &&
    prev.interactionMode === next.interactionMode &&
    prev.showGrid === next.showGrid &&
    prev.showRapidPath === next.showRapidPath &&
    prev.showPathTooltip === next.showPathTooltip &&
    prev.showOrientationGizmo === next.showOrientationGizmo &&
    prev.zoomRequestNonce === next.zoomRequestNonce &&
    prev.zoomRequestScale === next.zoomRequestScale &&
    prev.refocusNonce === next.refocusNonce &&
    prev.onRefocusApplied === next.onRefocusApplied &&
    prev.fitOnResize === next.fitOnResize &&
    prev.onRequestNamedView === next.onRequestNamedView
  );
}
