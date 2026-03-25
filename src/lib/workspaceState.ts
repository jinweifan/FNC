export type StoredWorkspaceWindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
};

export type MonitorWorkArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIN_WINDOW_WIDTH = 960;
const MIN_WINDOW_HEIGHT = 640;

export function sanitizeStoredWorkspaceWindowState(value: unknown): StoredWorkspaceWindowState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    !Number.isFinite(candidate.x)
    || !Number.isFinite(candidate.y)
    || !Number.isFinite(candidate.width)
    || !Number.isFinite(candidate.height)
    || typeof candidate.maximized !== "boolean"
  ) {
    return null;
  }
  const width = Math.round(Number(candidate.width));
  const height = Math.round(Number(candidate.height));
  if (width < 1 || height < 1) return null;
  return {
    x: Math.round(Number(candidate.x)),
    y: Math.round(Number(candidate.y)),
    width,
    height,
    maximized: candidate.maximized,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return min;
  return Math.min(Math.max(value, min), max);
}

function monitorContainsCenter(state: StoredWorkspaceWindowState, monitor: MonitorWorkArea): boolean {
  const centerX = state.x + state.width / 2;
  const centerY = state.y + state.height / 2;
  return (
    centerX >= monitor.x
    && centerX <= monitor.x + monitor.width
    && centerY >= monitor.y
    && centerY <= monitor.y + monitor.height
  );
}

export function clampWorkspaceWindowState(
  state: StoredWorkspaceWindowState,
  monitors: MonitorWorkArea[],
): StoredWorkspaceWindowState {
  if (!monitors.length) {
    return {
      ...state,
      width: Math.max(MIN_WINDOW_WIDTH, state.width),
      height: Math.max(MIN_WINDOW_HEIGHT, state.height),
    };
  }

  const activeMonitor = monitors.find((monitor) => monitorContainsCenter(state, monitor)) ?? monitors[0];
  const width = Math.min(Math.max(state.width, MIN_WINDOW_WIDTH), activeMonitor.width);
  const height = Math.min(Math.max(state.height, MIN_WINDOW_HEIGHT), activeMonitor.height);
  const x = clamp(state.x, activeMonitor.x, activeMonitor.x + activeMonitor.width - width);
  const y = clamp(state.y, activeMonitor.y, activeMonitor.y + activeMonitor.height - height);

  return {
    x,
    y,
    width,
    height,
    maximized: state.maximized,
  };
}
