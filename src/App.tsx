import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monacoApi from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { useTranslation } from "react-i18next";
import {
  FileUp,
  Save,
  SaveAll,
  Languages,
  Moon,
  Sun,
  Play,
  Pause,
  RotateCcw,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Compass,
  Drill,
  Expand,
  ZoomIn,
  ZoomOut,
  Hand,
  Rotate3d,
  Grid3X3,
  Eye,
  EyeOff,
  BadgeInfo,
  Keyboard,
  X,
  FolderOpen,
  Code2,
  Box,
  LocateFixed,
  Shrink,
} from "lucide-react";
import "./App.css";
import { Viewer3D } from "./components/Viewer3D";
import { splitCodeLines, toLoadedProgramState } from "./lib/loadedProgram";
import { enterImmersivePanes, exitImmersivePanes, toggleImmersiveDrawer } from "./lib/immersiveViewer";
import { resolveImmersiveSidebarLeft } from "./lib/immersiveSidebar";
import {
  findShortcutConflicts,
  formatShortcutForDisplay,
  getDefaultShortcuts,
  isApplePlatform,
  isModifierOnlyShortcut,
  keyboardEventToShortcut,
  type ShortcutId,
  type ShortcutMap,
} from "./lib/shortcuts";
import { getShortcutGroups } from "./lib/shortcutGroups";
import type { CameraState, FrameState, LoadedProgramState, NcFileItem, NcMode, ParseResult, Vec3 } from "./types";
import { parseNcToFrames } from "./lib/ncPath";

// Force local Monaco runtime (no CDN), critical for offline/Linux package environments.
loader.config({ monaco: monacoApi });

type ThemeMode = "system" | "light" | "navy" | "xdark";
type SpeedMode = "Low" | "Standard" | "High";
type InteractionMode = "pan" | "rotate";
type FileSortField = "createdAtMs" | "fileName" | "sizeBytes";
type SortOrder = "asc" | "desc";
type RecentFileItem = { path: string; fileName: string; lastOpenedAtMs: number };

const speedPointsPerSecond: Record<SpeedMode, number> = {
  Low: 60,
  Standard: 160,
  High: 360,
};
const STORAGE_THEME_KEY = "fnc.themeMode";
const STORAGE_LANG_KEY = "fnc.lang";
const STORAGE_SHOW_FILES_KEY = "fnc.showFiles";
const STORAGE_SHOW_EDITOR_KEY = "fnc.showEditor";
const STORAGE_SHOW_VIEWER_KEY = "fnc.showViewer";
const STORAGE_FILES_WIDTH_KEY = "fnc.filesWidth";
const STORAGE_EDITOR_WIDTH_KEY = "fnc.editorWidth";
const STORAGE_SHOW_GRID_KEY = "fnc.showGrid";
const STORAGE_SHOW_GIZMO_KEY = "fnc.showGizmo";
const STORAGE_RECENT_FILES_KEY = "fnc.recentFiles";
const STORAGE_SHORTCUTS_KEY = "fnc.shortcuts";


function dirname(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx > 0 ? path.slice(0, idx) : path;
}

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFileTime(createdAtMs: number, locale: string): string {
  if (!createdAtMs || Number.isNaN(createdAtMs)) return "-";
  return new Date(createdAtMs).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function centerOf(frames: FrameState[]): Vec3 {
  const b = boundsOf(frames);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2 };
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

function boundsOf(frames: FrameState[]) {
  const targetFrames = framesForCenter(frames);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const f of targetFrames) {
    minX = Math.min(minX, f.position.x);
    minY = Math.min(minY, f.position.y);
    minZ = Math.min(minZ, f.position.z);
    maxX = Math.max(maxX, f.position.x);
    maxY = Math.max(maxY, f.position.y);
    maxZ = Math.max(maxZ, f.position.z);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function fitDistanceForView(frames: FrameState[], viewName: string): number {
  const b = boundsOf(frames);
  const sx = Math.max(1, b.maxX - b.minX);
  const sy = Math.max(1, b.maxY - b.minY);
  const sz = Math.max(1, b.maxZ - b.minZ);
  const radius = Math.max(1, Math.hypot(sx, sy, sz) * 0.5);
  const vFov = (55 * Math.PI) / 180;
  // Assume a potentially narrow viewer panel; use a conservative horizontal half-fov.
  const assumedMinAspect = 0.55;
  const hFovConservative = 2 * Math.atan(Math.tan(vFov / 2) * assumedMinAspect);
  const minHalfFov = Math.max(0.08, Math.min(vFov / 2, hFovConservative / 2));
  const dSphere = radius / Math.sin(minHalfFov);
  const invTanV = 1 / Math.tan(vFov / 2);
  const invTanH = 1 / Math.tan(hFovConservative / 2);
  const m = 1.16; // fuller fit with minimal margin
  const fitPlane = (width: number, height: number) =>
    Math.max(width * 0.5 * invTanH, height * 0.5 * invTanV) * m;

  if (viewName === "Top" || viewName === "Bottom") {
    return Math.max(120, fitPlane(sx, sy));
  }
  if (viewName === "Front") {
    return Math.max(120, fitPlane(sx, sz));
  }
  if (viewName === "Left" || viewName === "Right") {
    return Math.max(120, fitPlane(sy, sz));
  }
  return Math.max(120, Math.max(radius * invTanV * m, dSphere * 1.15));
}

function cameraForView(frames: FrameState[], viewName: string): CameraState {
  const center = centerOf(frames);
  const d = fitDistanceForView(frames, viewName);
  const presets: Record<string, Vec3> = {
    Top: { x: center.x, y: center.y, z: center.z + d },
    Bottom: { x: center.x, y: center.y, z: center.z - d },
    Front: { x: center.x, y: center.y + d, z: center.z },
    Left: { x: center.x + d, y: center.y, z: center.z },
    Right: { x: center.x - d, y: center.y, z: center.z },
  };
  return {
    target: center,
    position: presets[viewName] ?? presets.Top,
    zoom: 1,
    viewName,
  };
}

function frameForLine(frames: FrameState[], lineNumber: number): FrameState | null {
  if (!frames.length) return null;
  let exact: FrameState | null = null;
  for (const frame of frames) {
    if (frame.lineNumber === lineNumber) {
      exact = frame;
      break;
    }
  }
  if (exact) return exact;
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    if (frames[i].lineNumber <= lineNumber) return frames[i];
  }
  return frames[0];
}

function inTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function detectNcMode(content: string): NcMode {
  const cleaned = content
    .replace(/\([^)]*\)/g, " ")
    .replace(/;.*$/gm, " ")
    .toUpperCase();
  return /\b(?:U|V|W)[+-]?\d+(?:\.\d+)?\b/.test(cleaned) ? "laser" : "normal";
}

function registerNcLanguage(monaco: typeof Monaco) {
  if (monaco.languages.getLanguages().some((l) => l.id === "ncgcode")) return;
  monaco.languages.register({ id: "ncgcode" });
  monaco.languages.setMonarchTokensProvider("ncgcode", {
    tokenizer: {
      root: [
        [/\([^)]*\)/, "comment"],
        [/;.*$/, "comment"],
        [/\bG0?0\b/i, "keyword.g.rapid"],
        [/\bG0?1\b/i, "keyword.g.linear"],
        [/\bG0?2\b/i, "keyword.g.arc.cw"],
        [/\bG0?3\b/i, "keyword.g.arc.ccw"],
        [/\bG1[789]\b/i, "keyword.g.plane"],
        [/\bG9[01]\b/i, "keyword.g.coord"],
        [/\bG5[4-9](?:\.1)?\b/i, "keyword.g.workoffset"],
        [/\bG4[012]\b/i, "keyword.g.comp"],
        [/\bG8[0123]\b/i, "keyword.g.cycle"],
        [/\bG\d+(?:\.\d+)?\b/i, "keyword.g.misc"],
        [/\bM\d+(?:\.\d+)?\b/i, "keyword.m"],
        [/\bT\d+\b/i, "keyword.t"],
        [/\b(?:X|Y|Z|U|V|W|A|B|C|I|J|K|R|F|S|P|Q|H|D)([+-]?\d+(?:\.\d+)?)\b/i, "number.axis"],
        [/\bN\d+\b/i, "number.line"],
      ],
    },
  });

  monaco.languages.registerFoldingRangeProvider("ncgcode", {
    provideFoldingRanges(model) {
      const ranges: Monaco.languages.FoldingRange[] = [];
      const lineCount = model.getLineCount();
      let start: number | null = null;
      let lastZ = 0;
      for (let i = 1; i <= lineCount; i += 1) {
        const text = model.getLineContent(i).toUpperCase();
        const zMatch = text.match(/\bZ([+-]?\d+(?:\.\d+)?)\b/);
        const z = zMatch ? Number(zMatch[1]) : null;
        const rapid = /\bG0?0\b/.test(text);
        const cut = /\bG0?1\b|\bG0?2\b|\bG0?3\b/.test(text);
        if (z !== null) {
          if (cut && z < lastZ - 0.2 && start === null) start = i;
          if (rapid && z > lastZ + 0.2 && start !== null && i - start > 3) {
            ranges.push({ start, end: i, kind: monaco.languages.FoldingRangeKind.Region });
            start = null;
          }
          lastZ = z;
        }
      }
      if (start !== null && lineCount - start > 3) {
        ranges.push({ start, end: lineCount, kind: monaco.languages.FoldingRangeKind.Region });
      }
      return ranges;
    },
  });

  monaco.editor.defineTheme("nc-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword.g.rapid", foreground: "94a3b8", fontStyle: "bold" },
      { token: "keyword.g.linear", foreground: "22d3ee", fontStyle: "bold" },
      { token: "keyword.g.arc.cw", foreground: "fb7185", fontStyle: "bold" },
      { token: "keyword.g.arc.ccw", foreground: "f97316", fontStyle: "bold" },
      { token: "keyword.g.plane", foreground: "2dd4bf", fontStyle: "bold" },
      { token: "keyword.g.coord", foreground: "facc15", fontStyle: "bold" },
      { token: "keyword.g.workoffset", foreground: "c084fc", fontStyle: "bold" },
      { token: "keyword.g.comp", foreground: "a3e635", fontStyle: "bold" },
      { token: "keyword.g.cycle", foreground: "f472b6", fontStyle: "bold" },
      { token: "keyword.g.misc", foreground: "38bdf8", fontStyle: "bold" },
      { token: "keyword.m", foreground: "f59e0b", fontStyle: "bold" },
      { token: "keyword.t", foreground: "818cf8", fontStyle: "bold" },
      { token: "number.axis", foreground: "cbd5e1" },
      { token: "number.line", foreground: "64748b" },
      { token: "comment", foreground: "64748b", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#0f172a",
      "editor.foreground": "#dbeafe",
      "editorLineNumber.foreground": "#64748b",
      "editor.lineHighlightBackground": "#13213b",
      "editorCursor.foreground": "#93c5fd",
      "editor.selectionBackground": "#1e3a8a55",
    },
  });

  monaco.editor.defineTheme("nc-x-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword.g.rapid", foreground: "8b98a5", fontStyle: "bold" },
      { token: "keyword.g.linear", foreground: "1d9bf0", fontStyle: "bold" },
      { token: "keyword.g.arc.cw", foreground: "f91880", fontStyle: "bold" },
      { token: "keyword.g.arc.ccw", foreground: "f97316", fontStyle: "bold" },
      { token: "keyword.g.plane", foreground: "00ba7c", fontStyle: "bold" },
      { token: "keyword.g.coord", foreground: "ffd400", fontStyle: "bold" },
      { token: "keyword.g.workoffset", foreground: "a78bfa", fontStyle: "bold" },
      { token: "keyword.g.comp", foreground: "84cc16", fontStyle: "bold" },
      { token: "keyword.g.cycle", foreground: "e879f9", fontStyle: "bold" },
      { token: "keyword.g.misc", foreground: "60a5fa", fontStyle: "bold" },
      { token: "keyword.m", foreground: "f59e0b", fontStyle: "bold" },
      { token: "keyword.t", foreground: "818cf8", fontStyle: "bold" },
      { token: "number.axis", foreground: "e7e9ea" },
      { token: "number.line", foreground: "556070" },
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#16181c",
      "editor.foreground": "#e7e9ea",
      "editorLineNumber.foreground": "#56606f",
      "editor.lineHighlightBackground": "#1e2228",
      "editorCursor.foreground": "#e7e9ea",
      "editor.selectionBackground": "#1d9bf055",
    },
  });

  monaco.editor.defineTheme("nc-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword.g.rapid", foreground: "64748b", fontStyle: "bold" },
      { token: "keyword.g.linear", foreground: "0ea5e9", fontStyle: "bold" },
      { token: "keyword.g.arc.cw", foreground: "e11d48", fontStyle: "bold" },
      { token: "keyword.g.arc.ccw", foreground: "ea580c", fontStyle: "bold" },
      { token: "keyword.g.plane", foreground: "0d9488", fontStyle: "bold" },
      { token: "keyword.g.coord", foreground: "ca8a04", fontStyle: "bold" },
      { token: "keyword.g.workoffset", foreground: "7c3aed", fontStyle: "bold" },
      { token: "keyword.g.comp", foreground: "4d7c0f", fontStyle: "bold" },
      { token: "keyword.g.cycle", foreground: "be185d", fontStyle: "bold" },
      { token: "keyword.g.misc", foreground: "0f766e", fontStyle: "bold" },
      { token: "keyword.m", foreground: "b45309", fontStyle: "bold" },
      { token: "keyword.t", foreground: "4f46e5", fontStyle: "bold" },
      { token: "number.axis", foreground: "1e293b" },
      { token: "number.line", foreground: "94a3b8" },
      { token: "comment", foreground: "94a3b8", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#0f172a",
      "editorLineNumber.foreground": "#94a3b8",
      "editor.lineHighlightBackground": "#f1f5f9",
      "editorCursor.foreground": "#0f172a",
      "editor.selectionBackground": "#bfdbfe66",
    },
  });
}

function App() {
  const { t, i18n } = useTranslation();
  const isMac = isApplePlatform(typeof navigator !== "undefined" ? navigator.platform : "");
  const defaultShortcuts = useMemo(
    () => getDefaultShortcuts(typeof navigator !== "undefined" ? navigator.platform : ""),
    [],
  );
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const viewMenuRef = useRef<HTMLDetailsElement | null>(null);
  const topChromeRef = useRef<HTMLDivElement | null>(null);
  const saveCurrentFileRef = useRef<(() => Promise<boolean>) | null>(null);
  const saveAsCurrentFileRef = useRef<(() => Promise<boolean>) | null>(null);
  const editorCursorListenerRef = useRef<Monaco.IDisposable | null>(null);
  const decoRef = useRef<string[]>([]);
  const parseDebounceRef = useRef<number | null>(null);
  const editorFollowResetTimerRef = useRef<number | null>(null);
  const suppressCursorSyncRef = useRef(false);
  const framesRef = useRef<FrameState[]>([]);
  const lastEditorFollowTsRef = useRef(0);
  const playProgressRef = useRef(0);
  const playProgressUiTsRef = useRef(0);
  const playProgressUiValueRef = useRef(0);
  const launchFileHandledRef = useRef(false);
  const recentRestoreHandledRef = useRef(false);
  const allowWindowCloseRef = useRef(false);
  const suppressCameraFeedbackUntilRef = useRef(0);
  const initialPanePrefs = (() => {
    const filesSaved = localStorage.getItem(STORAGE_SHOW_FILES_KEY);
    const editorSaved = localStorage.getItem(STORAGE_SHOW_EDITOR_KEY);
    const viewerSaved = localStorage.getItem(STORAGE_SHOW_VIEWER_KEY);
    const isFirstRun = filesSaved === null && editorSaved === null && viewerSaved === null;
    const files = filesSaved === "true";
    const editor = editorSaved === null ? true : editorSaved === "true";
    const viewer = viewerSaved === null ? true : viewerSaved === "true";
    // First-run default: editor + viewer opened, file list collapsed.
    if (isFirstRun) return { files: false, editor: true, viewer: true, isFirstRun: true };
    if (!files && !editor && !viewer) return { files: false, editor: true, viewer: true, isFirstRun: false };
    return { files, editor, viewer, isFirstRun: false };
  })();

  const [folderPath, setFolderPath] = useState("");
  const [filesInFolder, setFilesInFolder] = useState<NcFileItem[]>([]);
  const [fileSearch, setFileSearch] = useState("");
  const [fileSortField, setFileSortField] = useState<FileSortField>("createdAtMs");
  const [fileSortOrder, setFileSortOrder] = useState<SortOrder>("desc");
  const [activeFile, setActiveFile] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [launchProbeDone, setLaunchProbeDone] = useState(false);
  const [recentFiles, setRecentFiles] = useState<RecentFileItem[]>(() => {
    const raw = localStorage.getItem(STORAGE_RECENT_FILES_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as RecentFileItem[];
      return parsed
        .filter((it) => typeof it?.path === "string" && it.path && typeof it?.fileName === "string")
        .slice(0, 10);
    } catch {
      return [];
    }
  });
  const [code, setCode] = useState("");
  const [lastSavedContent, setLastSavedContent] = useState("");
  const [loadedProgram, setLoadedProgram] = useState<LoadedProgramState | null>(null);
  const [frames, setFrames] = useState<FrameState[]>([]);
  const [currentFrame, setCurrentFrame] = useState<FrameState | null>(null);
  const [hoverFrame, setHoverFrame] = useState<FrameState | null>(null);
  const [pathNavActive, setPathNavActive] = useState(false);
  const [cameraState, setCameraState] = useState<CameraState | null>(null);
  const [speed, setSpeed] = useState<SpeedMode>("Standard");
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("pan");
  const [showFiles, setShowFiles] = useState(initialPanePrefs.files);
  const [showEditor, setShowEditor] = useState(initialPanePrefs.editor);
  const [showViewer, setShowViewer] = useState(initialPanePrefs.viewer);
  const [filesWidth, setFilesWidth] = useState(() => {
    const raw = Number(localStorage.getItem(STORAGE_FILES_WIDTH_KEY));
    if (Number.isFinite(raw)) return Math.max(160, Math.min(600, raw));
    return 240;
  });
  const [editorWidth, setEditorWidth] = useState(() => {
    const raw = Number(localStorage.getItem(STORAGE_EDITOR_WIDTH_KEY));
    if (Number.isFinite(raw)) return Math.max(320, Math.min(1400, raw));
    if (initialPanePrefs.isFirstRun) {
      const approxWorkspace = Math.max(960, window.innerWidth - 84);
      // First-run default layout: editor : viewer = 1 : 4
      return Math.max(320, Math.min(1400, Math.round(approxWorkspace * 0.2)));
    }
    return 520;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [viewerZoomRequest, setViewerZoomRequest] = useState({ nonce: 0, scale: 1 });
  const [refocusNonce, setRefocusNonce] = useState(0);
  const [showRapidPath, setShowRapidPath] = useState(true);
  const [showGrid, setShowGrid] = useState(() => {
    const saved = localStorage.getItem(STORAGE_SHOW_GRID_KEY);
    return saved == null ? true : saved === "true";
  });
  const [showPathTooltip, setShowPathTooltip] = useState(true);
  const [showOrientationGizmo, setShowOrientationGizmo] = useState(() => {
    const saved = localStorage.getItem(STORAGE_SHOW_GIZMO_KEY);
    return saved == null ? true : saved === "true";
  });
  const [immersiveViewer, setImmersiveViewer] = useState(false);
  const [immersiveTopChromeVisible, setImmersiveTopChromeVisible] = useState(false);
  const [viewerHotkeyScope, setViewerHotkeyScope] = useState(false);
  const [status, setStatus] = useState(t("ready"));
  const [showShortcutModal, setShowShortcutModal] = useState(false);
  const [recordingShortcutId, setRecordingShortcutId] = useState<ShortcutId | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [fallbackEditor, setFallbackEditor] = useState(false);
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(() => {
    const raw = localStorage.getItem(STORAGE_SHORTCUTS_KEY);
    if (!raw) return defaultShortcuts;
    try {
      const parsed = JSON.parse(raw) as Partial<ShortcutMap>;
      return { ...defaultShortcuts, ...parsed };
    } catch {
      return defaultShortcuts;
    }
  });
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_THEME_KEY);
    if (saved === "navy" || saved === "xdark" || saved === "light" || saved === "system") return saved;
    // Backward compatibility: old "dark" was the navy theme.
    if (saved === "dark") return "navy";
    return "system";
  });
  const [ncMode, setNcMode] = useState<NcMode>("normal");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const dragState = useRef<{ pane: "files" | "editor"; startX: number; startWidth: number } | null>(null);

  const resolvedTheme: "light" | "navy" | "dark" = themeMode === "system"
    ? (systemDark ? "dark" : "light")
    : (themeMode === "xdark" ? "dark" : themeMode);
  const currentLocale = i18n.resolvedLanguage === "zh-CN" || i18n.language === "zh-CN" ? "zh-CN" : "en-US";
  const hasUnsavedChanges = Boolean(loadedProgram) && code !== lastSavedContent;
  const visiblePaneCount = [showFiles, showEditor, showViewer].filter(Boolean).length;
  const speedOptions: Array<{ value: SpeedMode; label: string }> = [
    { value: "Low", label: t("speedLow") },
    { value: "Standard", label: t("speedStandard") },
    { value: "High", label: t("speedHigh") },
  ];
  const shortcutItems: Array<{ id: ShortcutId; label: string }> = [
    { id: "openShortcuts", label: t("openShortcuts") },
    { id: "openNc", label: t("shortcutOpenNc") },
    { id: "saveFile", label: t("shortcutSaveFile") },
    { id: "saveFileAs", label: t("shortcutSaveFileAs") },
    { id: "toggleFiles", label: t("toggleFiles") },
    { id: "toggleEditor", label: t("toggleEditor") },
    { id: "toggleViewer", label: t("toggleViewer") },
    { id: "toggleImmersiveViewer", label: t("toggleImmersiveViewer") },
    { id: "refocus", label: t("refocus") },
    { id: "viewTop", label: t("shortcutViewTop") },
    { id: "viewFront", label: t("shortcutViewFront") },
    { id: "viewLeft", label: t("shortcutViewLeft") },
    { id: "viewRight", label: t("shortcutViewRight") },
    { id: "viewBottom", label: t("shortcutViewBottom") },
    { id: "panMode", label: t("panMode") },
    { id: "rotateMode", label: t("rotateMode") },
    { id: "zoomIn", label: t("zoomIn") },
    { id: "zoomOut", label: t("zoomOut") },
    { id: "toggleGrid", label: t("toggleGrid") },
    { id: "toggleGizmo", label: t("toggleGizmo") },
    { id: "toggleRapidPath", label: t("hideRapidPath") },
    { id: "togglePathTooltip", label: t("shortcutToggleLegend") },
    { id: "pathPrev", label: t("stepPrev") },
    { id: "pathNext", label: t("stepNext") },
  ];
  const shortcutItemMap = useMemo(
    () => Object.fromEntries(shortcutItems.map((item) => [item.id, item.label])) as Record<ShortcutId, string>,
    [shortcutItems],
  );
  const shortcutGroups = useMemo(() => {
    const descriptions = {
      file: t("shortcutGroupFileDesc"),
      panels: t("shortcutGroupPanelsDesc"),
      viewer: t("shortcutGroupViewerDesc"),
      path: t("shortcutGroupPathDesc"),
    } as const;
    const titles = {
      file: t("shortcutGroupFile"),
      panels: t("shortcutGroupPanels"),
      viewer: t("shortcutGroupViewer"),
      path: t("shortcutGroupPath"),
    } as const;
    return getShortcutGroups().map((group) => ({
      ...group,
      title: titles[group.id],
      description: descriptions[group.id],
      items: group.itemIds.map((id) => ({
        id,
        label: shortcutItemMap[id],
      })),
    }));
  }, [shortcutItemMap, t]);
  const updatePlayProgress = useCallback((value: number, force = false) => {
    playProgressRef.current = value;
    const now = performance.now();
    if (
      force
      || Math.abs(value - playProgressUiValueRef.current) >= 0.18
      || now - playProgressUiTsRef.current >= 33
    ) {
      playProgressUiValueRef.current = value;
      playProgressUiTsRef.current = now;
      setPlayProgress(value);
    }
  }, []);
  const setShortcutValue = useCallback((id: ShortcutId, value: string) => {
    setShortcuts((prev) => ({ ...prev, [id]: value }));
  }, []);
  const rememberRecentFile = useCallback((path: string) => {
    const item: RecentFileItem = {
      path,
      fileName: basename(path),
      lastOpenedAtMs: Date.now(),
    };
    setRecentFiles((prev) => {
      const deduped = prev.filter((it) => it.path !== path);
      return [item, ...deduped].slice(0, 10);
    });
  }, []);

  const visibleFiles = useMemo(() => {
    const keyword = fileSearch.trim().toLowerCase();
    const filtered = keyword
      ? filesInFolder.filter((item) => item.fileName.toLowerCase().includes(keyword))
      : filesInFolder.slice();

    const sorted = filtered.sort((a, b) => {
      const byNameAsc = a.fileName.localeCompare(
        b.fileName,
        currentLocale,
        { numeric: true },
      );
      let result = 0;
      if (fileSortField === "fileName") {
        result = byNameAsc;
      } else if (fileSortField === "createdAtMs") {
        result = a.createdAtMs - b.createdAtMs;
      } else {
        result = a.sizeBytes - b.sizeBytes;
      }
      if (result === 0) {
        // Secondary key is always filename asc for stable ordering.
        result = byNameAsc;
      }
      if (fileSortField === "createdAtMs") {
        // Default and expected behavior: created time first, filename second.
        return fileSortOrder === "asc" ? result : (a.createdAtMs === b.createdAtMs ? result : -result);
      }
      return fileSortOrder === "asc" ? result : -result;
    });

    return sorted;
  }, [currentLocale, fileSearch, filesInFolder, fileSortField, fileSortOrder]);
  const visibleRecentFiles = useMemo(() => {
    const keyword = fileSearch.trim().toLowerCase();
    const filtered = keyword
      ? recentFiles.filter((item) => item.fileName.toLowerCase().includes(keyword))
      : recentFiles.slice();
    return filtered
      .sort((a, b) => b.lastOpenedAtMs - a.lastOpenedAtMs)
      .slice(0, 10);
  }, [fileSearch, recentFiles]);
  const codeLines = useMemo(() => splitCodeLines(code), [code]);
  const shortcutConflicts = useMemo(() => findShortcutConflicts(shortcuts), [shortcuts]);
  const currentNcLineText = useMemo(() => {
    if (!currentFrame || !codeLines.length) return "-";
    const raw = codeLines[Math.max(0, currentFrame.lineNumber - 1)] ?? "";
    return raw.trim() || "-";
  }, [codeLines, currentFrame]);
  const legendTooltipText = useMemo(() => {
    const parts = [
      `${t("legendLineNo")}: ${currentFrame?.lineNumber ?? "-"}`,
      t("legendLine"),
      t("legendCurve"),
      t("legendRapid"),
      t("legendPlunge"),
      t("legendSelected"),
    ];
    if (ncMode === "laser") parts.push(t("legendUvw"));
    parts.push(`${t("currentCode")}: ${currentNcLineText}`);
    return parts.join(" | ");
  }, [currentFrame?.lineNumber, currentNcLineText, ncMode, t]);

  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);
  useEffect(() => {
    localStorage.setItem(STORAGE_THEME_KEY, themeMode);
  }, [themeMode]);
  useEffect(() => {
    localStorage.setItem(STORAGE_SHOW_FILES_KEY, String(showFiles));
  }, [showFiles]);
  useEffect(() => {
    localStorage.setItem(STORAGE_SHOW_EDITOR_KEY, String(showEditor));
  }, [showEditor]);
  useEffect(() => {
    localStorage.setItem(STORAGE_SHOW_VIEWER_KEY, String(showViewer));
  }, [showViewer]);

  useEffect(() => {
    localStorage.setItem(STORAGE_FILES_WIDTH_KEY, String(Math.round(filesWidth)));
  }, [filesWidth]);
  useEffect(() => {
    localStorage.setItem(STORAGE_EDITOR_WIDTH_KEY, String(Math.round(editorWidth)));
  }, [editorWidth]);
  useEffect(() => {
    localStorage.setItem(STORAGE_SHORTCUTS_KEY, JSON.stringify(shortcuts));
  }, [shortcuts]);
  useEffect(() => {
    localStorage.setItem(STORAGE_RECENT_FILES_KEY, JSON.stringify(recentFiles.slice(0, 10)));
  }, [recentFiles]);
  useEffect(() => {
    localStorage.setItem(STORAGE_SHOW_GRID_KEY, String(showGrid));
  }, [showGrid]);
  useEffect(() => {
    localStorage.setItem(STORAGE_SHOW_GIZMO_KEY, String(showOrientationGizmo));
  }, [showOrientationGizmo]);
  useEffect(() => {
    if (activeFile) setSelectedFilePath(activeFile);
  }, [activeFile]);
  useEffect(() => {
    if (!selectedFilePath && recentFiles.length > 0) {
      setSelectedFilePath(recentFiles[0].path);
    }
  }, [recentFiles, selectedFilePath]);
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_LANG_KEY);
    if (saved && saved !== currentLocale) {
      void i18n.changeLanguage(saved);
    }
    // Restore persisted locale only once on startup.
    // Re-running this effect on every locale change can revert the user's latest selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!monacoRef.current) return;
    if (resolvedTheme === "light") {
      monacoRef.current.editor.setTheme("nc-light");
    } else if (resolvedTheme === "navy") {
      monacoRef.current.editor.setTheme("nc-dark");
    } else {
      monacoRef.current.editor.setTheme("nc-x-dark");
    }
  }, [resolvedTheme]);

  useEffect(() => {
    if (editorReady || fallbackEditor) return;
    const timer = window.setTimeout(() => {
      setFallbackEditor(true);
      setStatus((prev) => `${prev} | Monaco loading timeout, switched to fallback editor`);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [editorReady, fallbackEditor]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const immersivePaneCap = Math.max(280, Math.floor((viewportWidth - 180) / 3));
    const onMove = (e: PointerEvent) => {
      if (!dragState.current) return;
      const diff = e.clientX - dragState.current.startX;
      if (dragState.current.pane === "files") {
        const nextWidth = dragState.current.startWidth + diff;
        setFilesWidth(
          immersiveViewer
            ? Math.max(Math.min(280, Math.min(520, immersivePaneCap)), Math.min(Math.min(520, immersivePaneCap), nextWidth))
            : Math.max(160, Math.min(600, nextWidth)),
        );
      } else {
        const nextWidth = dragState.current.startWidth + diff;
        setEditorWidth(
          immersiveViewer
            ? Math.max(Math.min(360, Math.min(680, immersivePaneCap)), Math.min(Math.min(680, immersivePaneCap), nextWidth))
            : Math.max(320, Math.min(1400, nextWidth)),
        );
      }
    };
    const onUp = () => {
      dragState.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [immersiveViewer, viewportWidth]);

  const openViewerPane = useCallback(() => {
    suppressCameraFeedbackUntilRef.current = performance.now() + 480;
    setRefocusNonce(0);
    setCameraState(frames.length > 1 ? cameraForView(frames, "Top") : null);
    setShowViewer(true);
  }, [frames]);

  const toggleFilesPane = useCallback(() => {
    if (immersiveViewer) {
      const next = toggleImmersiveDrawer({ showFiles, showEditor, showViewer: true }, "files");
      setShowFiles(next.showFiles);
      setShowEditor(next.showEditor);
      setShowViewer(next.showViewer);
      return;
    }
    if (showFiles && !showEditor && !showViewer) return;
    setShowFiles((v) => !v);
  }, [immersiveViewer, showEditor, showFiles, showViewer]);

  const toggleEditorPane = useCallback(() => {
    if (immersiveViewer) {
      const next = toggleImmersiveDrawer({ showFiles, showEditor, showViewer: true }, "editor");
      setShowFiles(next.showFiles);
      setShowEditor(next.showEditor);
      setShowViewer(next.showViewer);
      return;
    }
    if (showEditor && !showFiles && !showViewer) return;
    setShowEditor((v) => !v);
  }, [immersiveViewer, showEditor, showFiles, showViewer]);

  const toggleViewerPane = useCallback(() => {
    if (immersiveViewer) return;
    if (showViewer && !showFiles && !showEditor) return;
    if (!showViewer) {
      openViewerPane();
      return;
    }
    setShowViewer(false);
  }, [immersiveViewer, openViewerPane, showEditor, showFiles, showViewer]);

  const toggleImmersiveViewerMode = useCallback(() => {
    if (immersiveViewer) {
      const next = exitImmersivePanes({ showFiles, showEditor, showViewer: true });
      setImmersiveViewer(false);
      setImmersiveTopChromeVisible(false);
      setShowFiles(next.showFiles);
      setShowEditor(next.showEditor);
      setShowViewer(next.showViewer);
      return;
    }
    if (!showViewer) openViewerPane();
    const next = enterImmersivePanes({ showFiles, showEditor, showViewer: true });
    setImmersiveViewer(true);
    setImmersiveTopChromeVisible(false);
    setShowFiles(next.showFiles);
    setShowEditor(next.showEditor);
    setShowViewer(next.showViewer);
  }, [immersiveViewer, openViewerPane, showEditor, showFiles, showViewer]);

  const applyLoadedProgram = useCallback((result: ParseResult) => {
    const detectedMode = detectNcMode(result.content);
    setNcMode(detectedMode);
    const nextFrames = parseNcToFrames(result.content, detectedMode);
    setIsPlaying(false);
    setInteractionMode("pan");
    // Render directly at default view center (no recenter animation).
    suppressCameraFeedbackUntilRef.current = performance.now() + 520;
    setRefocusNonce(0);
    setCameraState(nextFrames.length > 1 ? cameraForView(nextFrames, "Top") : null);
    setLoadedProgram(toLoadedProgramState(result));
    setCode(result.content);
    setLastSavedContent(result.content);
    setFrames(nextFrames);
    setCurrentFrame(nextFrames[0]);
    updatePlayProgress(0, true);
    setHoverFrame(null);
    setPathNavActive(false);
    setStatus(`${t("loaded")}: ${result.fileName} (${nextFrames.length} pts)`);
  }, [t, updatePlayProgress]);

  const loadNcFile = useCallback(async (path: string) => {
    const result = await invoke<ParseResult>("open_nc_file", { path });
    setActiveFile(path);
    setSelectedFilePath(path);
    applyLoadedProgram(result);
    rememberRecentFile(path);
  }, [applyLoadedProgram, rememberRecentFile]);

  const loadNcFileWithFolderContext = useCallback(async (filePath: string) => {
    const dir = dirname(filePath);
    const files = await invoke<NcFileItem[]>("list_nc_files_in_folder", { folderPath: dir });
    setFolderPath(dir);
    setFilesInFolder(files);
    await loadNcFile(filePath);
  }, [loadNcFile]);

  const selectAndLoadFile = useCallback(async (path: string, withFolderContext: boolean) => {
    setSelectedFilePath(path);
    if (path === activeFile) return;
    if (withFolderContext) {
      await loadNcFileWithFolderContext(path);
      return;
    }
    await loadNcFile(path);
  }, [activeFile, loadNcFile, loadNcFileWithFolderContext]);

  const openNcFileByDialog = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "NC Files", extensions: ["nc", "anc"] }],
    });
    if (!selected || Array.isArray(selected)) return;

    await loadNcFileWithFolderContext(selected);
  };

  useEffect(() => {
    if (launchFileHandledRef.current) return;
    launchFileHandledRef.current = true;
    let unlistenLaunch: (() => void) | null = null;
    if (!inTauriRuntime()) {
      setLaunchProbeDone(true);
      return;
    }
    void (async () => {
      try {
        unlistenLaunch = await listen<string>("launch-nc-file", async (event) => {
          const launchPath = event.payload;
          if (!launchPath) return;
          await loadNcFileWithFolderContext(launchPath);
        });

        const pendingLaunches = await invoke<string[]>("take_pending_launch_nc_files");
        for (const launchPath of pendingLaunches) {
          if (!launchPath) continue;
          await loadNcFileWithFolderContext(launchPath);
        }
      } catch {
        // Ignore startup probe failures when web runtime is not fully initialized.
      } finally {
        setLaunchProbeDone(true);
      }
    })();
    return () => {
      if (unlistenLaunch) unlistenLaunch();
    };
  }, [loadNcFileWithFolderContext]);

  useEffect(() => {
    if (!launchProbeDone || recentRestoreHandledRef.current || activeFile || !recentFiles.length) return;
    recentRestoreHandledRef.current = true;
    const candidate = recentFiles[0].path;
    setSelectedFilePath(candidate);
    void loadNcFileWithFolderContext(candidate).catch(() => {
      setRecentFiles((prev) => prev.filter((it) => it.path !== candidate));
    });
  }, [activeFile, launchProbeDone, loadNcFileWithFolderContext, recentFiles]);

  useEffect(() => {
    if (!loadedProgram) return;
    if (parseDebounceRef.current) window.clearTimeout(parseDebounceRef.current);
    parseDebounceRef.current = window.setTimeout(() => {
      const detectedMode = detectNcMode(code);
      setNcMode((prev) => (prev === detectedMode ? prev : detectedMode));
      const updatedByMode = parseNcToFrames(code, detectedMode);
      setFrames(updatedByMode);
      setCurrentFrame((prev) => {
        if (!updatedByMode.length) return null;
        if (!prev) return updatedByMode[0];
        const byLine = frameForLine(updatedByMode, prev.lineNumber);
        if (byLine) return byLine;
        const fallbackIndex = Math.max(0, Math.min(updatedByMode.length - 1, prev.index ?? 0));
        return updatedByMode[fallbackIndex];
      });
      const safeProgress = Math.max(0, Math.min(updatedByMode.length - 1, playProgressRef.current));
      updatePlayProgress(safeProgress, true);
      setHoverFrame(null);
    }, 180);
    return () => {
      if (parseDebounceRef.current) window.clearTimeout(parseDebounceRef.current);
    };
  }, [code, loadedProgram, updatePlayProgress]);

  useEffect(() => {
    if (!isPlaying || frames.length < 2) return;
    let rafId = 0;
    let lastTs = performance.now();
    let progress = Math.max(0, Math.min(frames.length - 1, playProgressRef.current));
    let lastIndex = Math.floor(progress);

    const tick = (ts: number) => {
      const dt = Math.max(0, ts - lastTs);
      lastTs = ts;
      progress += (dt * speedPointsPerSecond[speed]) / 1000;
      if (progress >= frames.length - 1) {
        progress = frames.length - 1;
        updatePlayProgress(progress, true);
        setCurrentFrame(frames[frames.length - 1]);
        setIsPlaying(false);
        return;
      }
      updatePlayProgress(progress);
      const index = Math.floor(progress);
      if (index !== lastIndex) {
        lastIndex = index;
        setCurrentFrame(frames[index]);
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [isPlaying, frames, speed, updatePlayProgress]);

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    if (!currentFrame) {
      decoRef.current = editorRef.current.deltaDecorations(decoRef.current, []);
      return;
    }
    const now = performance.now();
    const shouldFollowCursor = !isPlaying || (now - lastEditorFollowTsRef.current > 120);
    if (shouldFollowCursor) {
      const currentLine = editorRef.current.getPosition()?.lineNumber ?? -1;
      if (currentLine !== currentFrame.lineNumber) {
        suppressCursorSyncRef.current = true;
        editorRef.current.setPosition({ lineNumber: currentFrame.lineNumber, column: 1 });
        if (isPlaying) {
          editorRef.current.revealLineNearTop(currentFrame.lineNumber);
        } else {
          editorRef.current.revealLineInCenter(currentFrame.lineNumber);
        }
        if (editorFollowResetTimerRef.current) {
          window.clearTimeout(editorFollowResetTimerRef.current);
        }
        editorFollowResetTimerRef.current = window.setTimeout(() => {
          suppressCursorSyncRef.current = false;
        }, 0);
      }
      lastEditorFollowTsRef.current = now;
    }
    decoRef.current = editorRef.current.deltaDecorations(decoRef.current, [
      {
        range: new monacoRef.current.Range(currentFrame.lineNumber, 1, currentFrame.lineNumber, 1),
        options: { isWholeLine: true, className: "current-line-highlight", glyphMarginClassName: "current-line-glyph" },
      },
    ]);
  }, [currentFrame, isPlaying]);

  useEffect(() => {
    return () => {
      if (editorFollowResetTimerRef.current) {
        window.clearTimeout(editorFollowResetTimerRef.current);
        editorFollowResetTimerRef.current = null;
      }
    };
  }, []);

  const onEditorMount: OnMount = (editor, monaco) => {
    setEditorReady(true);
    setFallbackEditor(false);
    monacoRef.current = monaco;
    editorRef.current = editor;
    registerNcLanguage(monaco);
    if (resolvedTheme === "light") {
      monaco.editor.setTheme("nc-light");
    } else if (resolvedTheme === "navy") {
      monaco.editor.setTheme("nc-dark");
    } else {
      monaco.editor.setTheme("nc-x-dark");
    }
    editorCursorListenerRef.current?.dispose();
    editorCursorListenerRef.current = editor.onDidChangeCursorPosition((e) => {
      if (suppressCursorSyncRef.current) return;
      const target = frameForLine(framesRef.current, e.position.lineNumber);
      if (!target) return;
      setPathNavActive(true);
      setHoverFrame(null);
      updatePlayProgress(target.index, true);
      setCurrentFrame((prev) => {
        if (prev && prev.index === target.index) return prev;
        return target;
      });
    });
  };

  useEffect(() => {
    return () => {
      editorCursorListenerRef.current?.dispose();
      editorCursorListenerRef.current = null;
    };
  }, []);

  const localizeMonacoFindWidget = useCallback(() => {
    const root = editorRef.current?.getDomNode();
    if (!root) return;
    const setLabel = (selector: string, text: string) => {
      const el = root.querySelector(selector) as HTMLElement | null;
      if (!el) return;
      el.setAttribute("title", text);
      el.setAttribute("aria-label", text);
    };
    setLabel(".find-widget .button.toggle", t("editorToggleReplace"));
    setLabel(".find-widget .button.previous", t("editorPrevMatch"));
    setLabel(".find-widget .button.next", t("editorNextMatch"));
    setLabel(".find-widget .button.replace", t("editorReplace"));
    setLabel(".find-widget .button.replace-all", t("editorReplaceAll"));
    setLabel(".find-widget > .button.codicon-widget-close", t("close"));
  }, [t]);

  useEffect(() => {
    if (!editorReady) return;
    localizeMonacoFindWidget();
    const root = editorRef.current?.getDomNode();
    if (!root) return;
    const observer = new MutationObserver(() => {
      localizeMonacoFindWidget();
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [currentLocale, editorReady, localizeMonacoFindWidget]);

  const startSimulation = async () => {
    if (!frames.length) return;
    setPathNavActive(true);
    setHoverFrame(null);
    setIsPlaying(false);
    setCurrentFrame(frames[0]);
    updatePlayProgress(0, true);
    setStatus(t("simStarted"));
  };

  const step = async (mode: "Prev" | "Next") => {
    if (!frames.length) return;
    setPathNavActive(true);
    setHoverFrame(null);
    setCurrentFrame((prev) => {
      const idx = prev?.index ?? 0;
      const next = mode === "Next"
        ? Math.min(frames.length - 1, idx + 1)
        : Math.max(0, idx - 1);
      updatePlayProgress(next, true);
      return frames[next];
    });
  };

  const togglePlay = () => {
    if (!frames.length) return;
    setIsPlaying((prev) => {
      const next = !prev;
      if (next) {
        setPathNavActive(true);
        setHoverFrame(null);
        setCurrentFrame((cur) => {
          if (!cur || cur.index >= frames.length - 1) {
            updatePlayProgress(0, true);
            return frames[0];
          }
          updatePlayProgress(cur.index, true);
          return cur;
        });
      }
      return next;
    });
  };

  const selectFrameByIndex = useCallback((index: number) => {
    if (!frames.length) return;
    const safe = Math.max(0, Math.min(frames.length - 1, index));
    updatePlayProgress(safe, true);
    setCurrentFrame(frames[safe]);
  }, [frames, updatePlayProgress]);

  const handleViewerFrameHover = useCallback((frame: FrameState) => {
    if (pathNavActive) return;
    setHoverFrame(frame);
  }, [pathNavActive]);

  const handleViewerFrameHoverEnd = useCallback(() => {
    setHoverFrame(null);
  }, []);

  const handleViewerFramePick = useCallback((frame: FrameState) => {
    setPathNavActive(true);
    setHoverFrame(null);
    setIsPlaying(false);
    selectFrameByIndex(frame.index);
  }, [selectFrameByIndex]);

  const handleViewerRefocusApplied = useCallback(() => {
    setRefocusNonce(0);
  }, []);

  const handleViewerRequestNamedView = useCallback((view: "Top" | "Front" | "Right") => {
    void setView(view);
  }, []);

  const handleViewerCameraStateChange = useCallback((next: CameraState) => {
    if (performance.now() < suppressCameraFeedbackUntilRef.current) return;
    setCameraState((prev) => {
      if (!prev) return next;
      const dp = Math.hypot(
        prev.position.x - next.position.x,
        prev.position.y - next.position.y,
        prev.position.z - next.position.z,
      );
      const dt = Math.hypot(
        prev.target.x - next.target.x,
        prev.target.y - next.target.y,
        prev.target.z - next.target.z,
      );
      if (dp < 1e-4 && dt < 1e-4 && prev.viewName === next.viewName) return prev;
      return next;
    });
  }, []);

  const setView = useCallback(async (name: string) => {
    if (frames.length) {
      suppressCameraFeedbackUntilRef.current = performance.now() + 260;
      setCameraState(cameraForView(frames, name));
    } else {
      const cur = currentFrame?.position ?? { x: 0, y: 0, z: 0 };
      const d = 220;
      const presets: Record<string, Vec3> = {
        Top: { x: cur.x, y: cur.y, z: cur.z + d },
        Bottom: { x: cur.x, y: cur.y, z: cur.z - d },
        Front: { x: cur.x, y: cur.y + d, z: cur.z },
        Left: { x: cur.x + d, y: cur.y, z: cur.z },
        Right: { x: cur.x - d, y: cur.y, z: cur.z },
      };
      suppressCameraFeedbackUntilRef.current = performance.now() + 260;
      setCameraState({ target: cur, position: presets[name] ?? presets.Top, zoom: 1, viewName: name });
    }
  }, [currentFrame?.position, frames]);

  const applyView = useCallback((name: string) => {
    viewMenuRef.current?.removeAttribute("open");
    void setView(name);
  }, [setView]);

  const requestViewerZoom = useCallback((scale: number) => {
    setViewerZoomRequest((prev) => ({ nonce: prev.nonce + 1, scale }));
  }, []);

  const refocusCenter = useCallback(() => {
    if (!frames.length) return;
    // Hard-reset to the same initial top-view state used on file load/open.
    suppressCameraFeedbackUntilRef.current = performance.now() + 260;
    setRefocusNonce(0);
    setCameraState(cameraForView(frames, "Top"));
    setStatus(t("refocused"));
  }, [frames, t]);

  const displayShortcut = useCallback((shortcut: string) => formatShortcutForDisplay(shortcut, isMac), [isMac]);
  const tooltipWithShortcut = useCallback((label: string, shortcut: string) => `${label} (${displayShortcut(shortcut)})`, [displayShortcut]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (showShortcutModal && key === "escape") {
        e.preventDefault();
        setRecordingShortcutId(null);
        setShowShortcutModal(false);
        return;
      }
      if (recordingShortcutId) return;
      const pressed = keyboardEventToShortcut(e);
      if (pressed === shortcuts.openNc) {
        e.preventDefault();
        void openNcFileByDialog();
        return;
      }
      if (pressed === shortcuts.saveFile) {
        e.preventDefault();
        void saveCurrentFileRef.current?.();
        return;
      }
      if (pressed === shortcuts.saveFileAs) {
        e.preventDefault();
        void saveAsCurrentFileRef.current?.();
        return;
      }
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inEditor = Boolean(
        target?.closest(".monaco-editor, .monaco-editor *") ||
        target?.classList?.contains("inputarea"),
      );
      const isEditable = tag === "input" || tag === "textarea" || target?.isContentEditable;
      if (isEditable || inEditor) return;

      if (pressed === shortcuts.toggleFiles) {
        e.preventDefault();
        toggleFilesPane();
        return;
      }
      if (pressed === shortcuts.openShortcuts) {
        e.preventDefault();
        setShowShortcutModal((prev) => !prev);
        setRecordingShortcutId(null);
        return;
      }
      if (pressed === shortcuts.toggleEditor) {
        e.preventDefault();
        toggleEditorPane();
        return;
      }
      if (pressed === shortcuts.toggleViewer) {
        e.preventDefault();
        toggleViewerPane();
        return;
      }
      if (pressed === shortcuts.toggleImmersiveViewer) {
        e.preventDefault();
        toggleImmersiveViewerMode();
        return;
      }
      if (key === "escape") {
        if (viewerHotkeyScope) {
          e.preventDefault();
          setIsPlaying(false);
          setHoverFrame(null);
          setPathNavActive(false);
          setCurrentFrame(null);
          return;
        }
        if (immersiveViewer) {
          e.preventDefault();
          setImmersiveTopChromeVisible(false);
          return;
        }
        return;
      }

      const is3DAction = [
        shortcuts.refocus,
        shortcuts.viewTop,
        shortcuts.viewFront,
        shortcuts.viewLeft,
        shortcuts.viewRight,
        shortcuts.viewBottom,
        shortcuts.panMode,
        shortcuts.rotateMode,
        shortcuts.zoomIn,
        shortcuts.zoomOut,
        shortcuts.toggleGrid,
        shortcuts.toggleGizmo,
        shortcuts.toggleRapidPath,
        shortcuts.togglePathTooltip,
        shortcuts.toggleImmersiveViewer,
        shortcuts.pathPrev,
        shortcuts.pathNext,
      ].includes(pressed);
      if (is3DAction && !(viewerHotkeyScope || immersiveViewer)) return;

      // Always keep plain "F" available as a hard fallback for refocus.
      if (pressed === shortcuts.refocus || (!e.ctrlKey && !e.altKey && !e.metaKey && key === "f")) {
        e.preventDefault();
        refocusCenter();
        return;
      }
      if (pressed === shortcuts.viewTop) {
        e.preventDefault();
        applyView("Top");
        return;
      }
      if (pressed === shortcuts.viewFront) {
        e.preventDefault();
        applyView("Front");
        return;
      }
      if (pressed === shortcuts.viewLeft) {
        e.preventDefault();
        applyView("Left");
        return;
      }
      if (pressed === shortcuts.viewRight) {
        e.preventDefault();
        applyView("Right");
        return;
      }
      if (pressed === shortcuts.viewBottom) {
        e.preventDefault();
        applyView("Bottom");
        return;
      }
      if (pressed === shortcuts.panMode) {
        e.preventDefault();
        setInteractionMode("pan");
        return;
      }
      if (pressed === shortcuts.rotateMode) {
        e.preventDefault();
        setInteractionMode("rotate");
        return;
      }
      if (pressed === shortcuts.zoomIn || key === "=" && shortcuts.zoomIn === "+") {
        e.preventDefault();
        requestViewerZoom(0.74);
        return;
      }
      if (pressed === shortcuts.zoomOut) {
        e.preventDefault();
        requestViewerZoom(1.35);
        return;
      }
      if (pressed === shortcuts.toggleGrid) {
        e.preventDefault();
        setShowGrid((v) => !v);
        return;
      }
      if (pressed === shortcuts.toggleGizmo) {
        e.preventDefault();
        setShowOrientationGizmo((v) => !v);
        return;
      }
      if (pressed === shortcuts.toggleRapidPath) {
        e.preventDefault();
        setShowRapidPath((v) => !v);
        return;
      }
      if (pressed === shortcuts.togglePathTooltip) {
        e.preventDefault();
        setShowPathTooltip((v) => !v);
        return;
      }
      if (!pathNavActive || !currentFrame) return;
      if (pressed === shortcuts.pathPrev) {
        e.preventDefault();
        setHoverFrame(null);
        selectFrameByIndex((currentFrame.index ?? 0) - 1);
      } else if (pressed === shortcuts.pathNext) {
        e.preventDefault();
        setHoverFrame(null);
        selectFrameByIndex((currentFrame.index ?? 0) + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    recordingShortcutId,
    showShortcutModal,
    currentFrame,
    pathNavActive,
    refocusCenter,
    selectFrameByIndex,
    toggleEditorPane,
    toggleFilesPane,
    toggleViewerPane,
    toggleImmersiveViewerMode,
    shortcuts,
    viewerHotkeyScope,
    immersiveViewer,
    requestViewerZoom,
    applyView,
  ]);

  const onShortcutRecorderKeyDown = useCallback((id: ShortcutId, e: ReactKeyboardEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setRecordingShortcutId(null);
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      setShortcutValue(id, "");
      setRecordingShortcutId(null);
      return;
    }
    const shortcut = keyboardEventToShortcut(e.nativeEvent);
    if (!shortcut || isModifierOnlyShortcut(shortcut)) return;
    setShortcutValue(id, shortcut);
    setRecordingShortcutId(null);
  }, [setShortcutValue]);

  useEffect(() => {
    if (showShortcutModal) return;
    setRecordingShortcutId(null);
  }, [showShortcutModal]);

  useEffect(() => {
    if (!recordingShortcutId) return;
    const onRecordKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecordingShortcutId(null);
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        setShortcutValue(recordingShortcutId, "");
        setRecordingShortcutId(null);
        return;
      }
      const shortcut = keyboardEventToShortcut(e);
      if (!shortcut || isModifierOnlyShortcut(shortcut)) return;
      setShortcutValue(recordingShortcutId, shortcut);
      setRecordingShortcutId(null);
    };
    window.addEventListener("keydown", onRecordKeyDown, true);
    return () => window.removeEventListener("keydown", onRecordKeyDown, true);
  }, [recordingShortcutId, setShortcutValue]);

  const shortcutConflictMessage = useMemo(() => {
    if (!recordingShortcutId) return "";
    const conflictIds = shortcutConflicts[recordingShortcutId];
    if (!conflictIds?.length) return "";
    const names = conflictIds
      .map((id) => shortcutItemMap[id] ?? id)
      .join("、");
    return `${displayShortcut(shortcuts[recordingShortcutId])} ${t("shortcutConflictWith")} ${names}`;
  }, [displayShortcut, recordingShortcutId, shortcutConflicts, shortcutItemMap, shortcuts, t]);

  const saveToPath = useCallback(async (path: string) => {
    await invoke("export_nc_file", {
      path,
      content: code,
      exportOptions: { encoding: "Utf8", lineEnding: "CrLf" },
    });
    setActiveFile(path);
    setLastSavedContent(code);
    const dir = dirname(path);
    const files = await invoke<NcFileItem[]>("list_nc_files_in_folder", { folderPath: dir });
    setFolderPath(dir);
    setFilesInFolder(files);
    setStatus(`${t("saved")}: ${basename(path)}`);
    return true;
  }, [code, t]);

  const saveAsCurrentFile = useCallback(async () => {
    const targetPath = await save({
      filters: [{ name: "NC Files", extensions: ["nc", "anc"] }],
      defaultPath: activeFile || "program.nc",
    });
    if (!targetPath) return false;
    return saveToPath(targetPath);
  }, [activeFile, saveToPath]);

  const saveCurrentFile = useCallback(async () => {
    if (!loadedProgram) return false;
    if (!activeFile) return saveAsCurrentFile();
    return saveToPath(activeFile);
  }, [activeFile, loadedProgram, saveAsCurrentFile, saveToPath]);

  useEffect(() => {
    saveCurrentFileRef.current = saveCurrentFile;
    saveAsCurrentFileRef.current = saveAsCurrentFile;
  }, [saveAsCurrentFile, saveCurrentFile]);

  useEffect(() => {
    if (!immersiveViewer || immersiveTopChromeVisible) return;
    viewMenuRef.current?.removeAttribute("open");
    const active = document.activeElement;
    if (active instanceof HTMLElement && topChromeRef.current?.contains(active)) {
      active.blur();
    }
  }, [immersiveTopChromeVisible, immersiveViewer]);

  useEffect(() => {
    if (!inTauriRuntime()) return;
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | null = null;
    void appWindow.onCloseRequested(async (event) => {
      if (allowWindowCloseRef.current) {
        allowWindowCloseRef.current = false;
        return;
      }
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      const saveLabel = t("save");
      const discardLabel = t("discardChanges");
      const cancelLabel = t("cancel");
      const choice = await message(t("exitUnsavedPrompt"), {
        title: t("unsavedTitle"),
        kind: "warning",
        buttons: { yes: saveLabel, no: discardLabel, cancel: cancelLabel },
      });
      if (choice === saveLabel) {
        const saved = await saveCurrentFile();
        if (saved) {
          allowWindowCloseRef.current = true;
          await appWindow.close();
        }
        return;
      }
      if (choice === discardLabel) {
        allowWindowCloseRef.current = true;
        await appWindow.close();
      }
    }).then((fn) => {
      unlisten = fn;
    });

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      if (unlisten) unlisten();
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [hasUnsavedChanges, saveCurrentFile, t]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, pane: "files" | "editor", width: number) => {
    dragState.current = { pane, startX: event.clientX, startWidth: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const changeLocale = async (locale: string) => {
    if (locale === currentLocale) return;
    await i18n.changeLanguage(locale);
    localStorage.setItem(STORAGE_LANG_KEY, locale);
    await invoke("set_locale", { locale });
  };
  const showImmersiveFilesPane = immersiveViewer || showFiles;
  const showImmersiveEditorPane = immersiveViewer || showEditor;
  const showImmersiveViewerPane = immersiveViewer || showViewer;
  const immersivePaneCap = Math.max(280, Math.floor((viewportWidth - 180) / 3));
  const immersiveFilesWidth = Math.max(
    Math.min(280, Math.min(520, immersivePaneCap)),
    Math.min(Math.min(520, immersivePaneCap), filesWidth),
  );
  const immersiveEditorWidth = Math.max(
    Math.min(360, Math.min(680, immersivePaneCap)),
    Math.min(Math.min(680, immersivePaneCap), editorWidth),
  );
  const immersiveFilePaneStyle: CSSProperties = immersiveViewer
    ? { width: `${immersiveFilesWidth}px`, maxWidth: `min(${immersiveFilesWidth}px, 33vw)` }
    : ((showEditor || showViewer)
      ? { flex: `0 1 ${filesWidth}px`, maxWidth: `${filesWidth}px` }
      : { flex: "1 1 auto" });
  const immersiveEditorPaneStyle: CSSProperties = immersiveViewer
    ? { width: `${immersiveEditorWidth}px`, maxWidth: `min(${immersiveEditorWidth}px, 33vw)` }
    : (showViewer
      ? { flex: `0 1 ${editorWidth}px`, maxWidth: `${editorWidth}px` }
      : { flex: "1 1 auto" });
  const immersiveSidebarStyle: CSSProperties | undefined = immersiveViewer
    ? {
      left: `${resolveImmersiveSidebarLeft({
        immersiveViewer,
        showFiles,
        showEditor,
        filesWidth: immersiveFilesWidth,
        editorWidth: immersiveEditorWidth,
      })}px`,
    }
    : undefined;
  const immersiveTopChromeStyle: (CSSProperties & Record<"--immersive-top-left-safe" | "--immersive-top-right-safe", string>) | undefined = immersiveViewer
    ? {
      "--immersive-top-left-safe": `${Math.max(
        84,
        resolveImmersiveSidebarLeft({
          immersiveViewer,
          showFiles,
          showEditor,
          filesWidth: immersiveFilesWidth,
          editorWidth: immersiveEditorWidth,
        }) + 64,
      )}px`,
      "--immersive-top-right-safe": "84px",
    }
    : undefined;
  const shortcutButtonTooltip = tooltipWithShortcut(t("shortcuts"), shortcuts.openShortcuts);
  const filesButtonTooltip = tooltipWithShortcut(t("toggleFiles"), shortcuts.toggleFiles);
  const editorButtonTooltip = tooltipWithShortcut(t("toggleEditor"), shortcuts.toggleEditor);
  const viewerButtonTooltip = tooltipWithShortcut(t("toggleViewer"), shortcuts.toggleViewer);
  const immersiveViewerTooltip = tooltipWithShortcut(
    immersiveViewer ? t("exitImmersiveViewer") : t("enterImmersiveViewer"),
    shortcuts.toggleImmersiveViewer,
  );
  const immersiveFilesSplitterStyle: CSSProperties | undefined = immersiveViewer && showFiles
    ? { left: `${immersiveFilesWidth}px` }
    : undefined;
  const immersiveEditorSplitterStyle: CSSProperties | undefined = immersiveViewer && showEditor
    ? { left: `${immersiveEditorWidth}px` }
    : undefined;
  const fileMenu = (
    <div className="menu-group">
      <button className="menu-btn" data-ui-tooltip={tooltipWithShortcut(t("openNc"), shortcuts.openNc)} onClick={() => void openNcFileByDialog()}><FileUp size={14} />{t("openNc")}</button>
      <button className="menu-btn" data-ui-tooltip={tooltipWithShortcut(t("save"), shortcuts.saveFile)} onClick={() => void saveCurrentFile()}><Save size={14} />{t("save")}</button>
      <button className="menu-btn" data-ui-tooltip={tooltipWithShortcut(t("saveAs"), shortcuts.saveFileAs)} onClick={() => void saveAsCurrentFile()}><SaveAll size={14} />{t("saveAs")}</button>
    </div>
  );

  return (
    <div className={`app-shell compact${immersiveViewer ? " immersive-viewer" : ""}${immersiveTopChromeVisible ? " immersive-chrome-visible" : ""}`}>
      {immersiveViewer && (
        <div
          className="immersive-top-hotzone"
          onMouseEnter={() => setImmersiveTopChromeVisible(true)}
        />
      )}
      <div
        className={`top-chrome${immersiveViewer ? " immersive" : ""}${immersiveTopChromeVisible ? " visible" : ""}`}
        ref={topChromeRef}
        style={immersiveTopChromeStyle}
        onMouseEnter={() => immersiveViewer && setImmersiveTopChromeVisible(true)}
        onMouseLeave={() => immersiveViewer && setImmersiveTopChromeVisible(false)}
      >
        <div className="menu-bar">
          <div className="menu-left">
            {fileMenu}
            <div className="menu-tag">{folderPath || t("noFolder")}</div>
          </div>
          <div className="menu-right">
            <button className="menu-btn" data-ui-tooltip={shortcutButtonTooltip} onClick={() => setShowShortcutModal(true)}>
              <Keyboard size={14} />{t("shortcuts")}
            </button>
            <div className="menu-mode-readonly">
              <Drill size={13} />
              <span>{t("mode")}:</span>
              <b>{ncMode === "laser" ? t("modeLaser") : t("modeNormal")}</b>
            </div>
            <div className="menu-inline-control">
              <label><Languages size={13} />{t("language")}</label>
              <select value={currentLocale} onChange={(e) => void changeLocale(e.target.value)}>
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </select>
            </div>
            <div className="menu-inline-control">
              <label>{resolvedTheme === "light" ? <Sun size={13} /> : <Moon size={13} />}{t("theme")}</label>
              <select value={themeMode} onChange={(e) => setThemeMode(e.target.value as ThemeMode)}>
                <option value="system">{t("themeSystem")}</option>
                <option value="navy">{t("themeNavy")}</option>
                <option value="xdark">{t("themeDark")}</option>
                <option value="light">{t("themeLight")}</option>
              </select>
            </div>
          </div>
        </div>

        <div className="tool-bar">
          <div className="tool-left tool-cluster">
            <button className="icon-btn" onClick={() => void startSimulation()} data-ui-tooltip={t("resetSim")} aria-label={t("resetSim")}>
              <RotateCcw size={14} />
            </button>
            <button className="icon-btn" onClick={togglePlay} data-ui-tooltip={isPlaying ? t("pause") : t("play")} aria-label={isPlaying ? t("pause") : t("play")}>
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button className="icon-btn" onClick={() => void step("Prev")} data-ui-tooltip={t("stepPrev")} aria-label={t("stepPrev")}><ArrowLeft size={14} /></button>
            <button className="icon-btn" onClick={() => void step("Next")} data-ui-tooltip={t("stepNext")} aria-label={t("stepNext")}><ArrowRight size={14} /></button>
            <div className="tool-divider" />
            <select value={speed} onChange={(e) => setSpeed(e.target.value as SpeedMode)} title={t("speed")}>
              {speedOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="tool-right tool-cluster">
            <button className="icon-btn" data-ui-tooltip={tooltipWithShortcut(t("refocus"), shortcuts.refocus)} onClick={refocusCenter}><LocateFixed size={14} /></button>
            <div className="tool-divider" />
            <details className="view-menu" ref={viewMenuRef}>
              <summary className="menu-btn icon-btn" data-ui-tooltip={t("viewPresets")}>
                <Compass size={14} />
              </summary>
              <div className="view-menu-list">
                  <button data-ui-tooltip={tooltipWithShortcut(t("top"), shortcuts.viewTop)} onClick={() => applyView("Top")}><ArrowUp size={14} /><span>{t("top")}</span></button>
                  <button data-ui-tooltip={tooltipWithShortcut(t("front"), shortcuts.viewFront)} onClick={() => applyView("Front")}><Compass size={14} /><span>{t("front")}</span></button>
                  <button data-ui-tooltip={tooltipWithShortcut(t("left"), shortcuts.viewLeft)} onClick={() => applyView("Left")}><ArrowLeft size={14} /><span>{t("left")}</span></button>
                  <button data-ui-tooltip={tooltipWithShortcut(t("right"), shortcuts.viewRight)} onClick={() => applyView("Right")}><ArrowRight size={14} /><span>{t("right")}</span></button>
                  <button data-ui-tooltip={tooltipWithShortcut(t("bottom"), shortcuts.viewBottom)} onClick={() => applyView("Bottom")}><ArrowDown size={14} /><span>{t("bottom")}</span></button>
              </div>
            </details>
            <button
              className={interactionMode === "pan" ? "mode-btn icon-btn active" : "mode-btn icon-btn"}
              data-ui-tooltip={tooltipWithShortcut(t("panMode"), shortcuts.panMode)}
              onClick={() => setInteractionMode("pan")}
              aria-label={t("panMode")}
            >
              <Hand size={14} />
            </button>
            <button
              className={interactionMode === "rotate" ? "mode-btn icon-btn active" : "mode-btn icon-btn"}
              data-ui-tooltip={tooltipWithShortcut(t("rotateMode"), shortcuts.rotateMode)}
              onClick={() => setInteractionMode("rotate")}
              aria-label={t("rotateMode")}
            >
              <Rotate3d size={14} />
            </button>
            <div className="tool-divider" />
            <button className="icon-btn" data-ui-tooltip={tooltipWithShortcut(t("zoomIn"), shortcuts.zoomIn)} onClick={() => requestViewerZoom(0.74)}><ZoomIn size={14} /></button>
            <button className="icon-btn" data-ui-tooltip={tooltipWithShortcut(t("zoomOut"), shortcuts.zoomOut)} onClick={() => requestViewerZoom(1.35)}><ZoomOut size={14} /></button>
            <div className="tool-divider" />
            <button
              className="icon-btn"
              data-ui-tooltip={tooltipWithShortcut(showGrid ? t("hideGrid") : t("showGrid"), shortcuts.toggleGrid)}
              onClick={() => setShowGrid((v) => !v)}
            >
              <Grid3X3 size={14} />
            </button>
            <button
              className="icon-btn"
              data-ui-tooltip={tooltipWithShortcut(showOrientationGizmo ? t("hideGizmo") : t("showGizmo"), shortcuts.toggleGizmo)}
              onClick={() => setShowOrientationGizmo((v) => !v)}
            >
              <Compass size={14} />
            </button>
            <button
              className="icon-btn"
              data-ui-tooltip={tooltipWithShortcut(showRapidPath ? t("hideRapidPath") : t("showRapidPath"), shortcuts.toggleRapidPath)}
              onClick={() => setShowRapidPath((v) => !v)}
            >
              {showRapidPath ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              className="icon-btn"
              data-ui-tooltip={tooltipWithShortcut(showPathTooltip ? t("hidePathTooltip") : t("showPathTooltip"), shortcuts.togglePathTooltip)}
              onClick={() => setShowPathTooltip((v) => !v)}
            >
              <BadgeInfo size={14} />
            </button>
          </div>
        </div>
      </div>

      <main className={`${visiblePaneCount <= 1 && !immersiveViewer ? "workspace-row single-pane" : "workspace-row"}${immersiveViewer ? " immersive-viewer-layout" : ""}`}>
        <aside className="left-sidebar" style={immersiveSidebarStyle}>
          <button
            className={showFiles ? "side-btn active" : "side-btn"}
            data-ui-tooltip={filesButtonTooltip}
            onClick={toggleFilesPane}
          >
            <FolderOpen size={16} />
          </button>
          <button
            className={showEditor ? "side-btn active" : "side-btn"}
            data-ui-tooltip={editorButtonTooltip}
            onClick={toggleEditorPane}
          >
            <Code2 size={16} />
          </button>
          <button
            className={showViewer ? "side-btn active" : "side-btn"}
            data-ui-tooltip={viewerButtonTooltip}
            onClick={toggleViewerPane}
          >
            <Box size={16} />
          </button>
        </aside>

        <div className={`workspace-flex${immersiveViewer ? " immersive-workspace-flex" : ""}`}>
          {showImmersiveFilesPane && (
          <aside
            className={`file-pane panel${immersiveViewer ? " immersive-drawer immersive-drawer-files" : ""}${immersiveViewer && !showFiles ? " immersive-drawer-hidden" : ""}`}
            style={immersiveFilePaneStyle}
          >
            <h3>{t("files")}</h3>
            <div className="file-toolbar">
              <input
                className="file-search-input"
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                placeholder={t("fileSearchPlaceholder")}
              />
              <div className="file-sort-row">
                <select value={fileSortField} onChange={(e) => setFileSortField(e.target.value as FileSortField)}>
                  <option value="createdAtMs">{t("fileSortByCreated")}</option>
                  <option value="fileName">{t("fileSortByName")}</option>
                  <option value="sizeBytes">{t("fileSortBySize")}</option>
                </select>
                <select value={fileSortOrder} onChange={(e) => setFileSortOrder(e.target.value as SortOrder)}>
                  <option value="desc">{t("sortDesc")}</option>
                  <option value="asc">{t("sortAsc")}</option>
                </select>
              </div>
            </div>
            <div className="file-list">
              {visibleFiles.length > 0 && visibleFiles.map((item) => (
                <button
                  key={item.path}
                  className={item.path === selectedFilePath ? "file-item active" : "file-item"}
                  onClick={() => {
                    void selectAndLoadFile(item.path, false).catch(() => {});
                  }}
                      title={`${item.fileName} | ${formatFileTime(item.createdAtMs, currentLocale)} | ${formatFileSize(item.sizeBytes)}`}
                >
                  <span className="file-item-name">{item.fileName}</span>
                  <span className="file-item-meta">
                      <span className="file-item-created">{formatFileTime(item.createdAtMs, currentLocale)}</span>
                    <span className="file-item-size">{formatFileSize(item.sizeBytes)}</span>
                  </span>
                </button>
              ))}
              {visibleFiles.length === 0 && visibleRecentFiles.length > 0 && (
                <>
                  <div className="empty">{t("recentFiles")}</div>
                  {visibleRecentFiles.map((item) => (
                    <button
                      key={item.path}
                      className={item.path === selectedFilePath ? "file-item active" : "file-item"}
                      onClick={() => {
                        void selectAndLoadFile(item.path, true).catch(() => {
                          setRecentFiles((prev) => prev.filter((it) => it.path !== item.path));
                        });
                      }}
                      title={`${item.fileName} | ${t("lastOpened")}: ${formatFileTime(item.lastOpenedAtMs, currentLocale)}`}
                    >
                      <span className="file-item-name">{item.fileName}</span>
                      <span className="file-item-meta">
                      <span className="file-item-created">{t("lastOpened")}: {formatFileTime(item.lastOpenedAtMs, currentLocale)}</span>
                      </span>
                    </button>
                  ))}
                </>
              )}
              {visibleFiles.length === 0 && visibleRecentFiles.length === 0 && (
                <div className="empty">{filesInFolder.length ? t("noSearchResult") : t("noRecentFiles")}</div>
              )}
            </div>
          </aside>
          )}

          {immersiveViewer && showFiles && (
            <div
              className="splitter immersive-splitter"
              style={immersiveFilesSplitterStyle}
              onPointerDown={(e) => startDrag(e, "files", filesWidth)}
            />
          )}

          {!immersiveViewer && showFiles && (showEditor || showViewer) && (
            <div className="splitter" onPointerDown={(e) => startDrag(e, "files", filesWidth)} />
          )}

          {showImmersiveEditorPane && (
          <section
            className={`editor-pane panel${immersiveViewer ? " immersive-drawer immersive-drawer-editor" : ""}${immersiveViewer && !showEditor ? " immersive-drawer-hidden" : ""}`}
            style={immersiveEditorPaneStyle}
          >
            <h3>{t("editor")}</h3>
            {!fallbackEditor ? (
              <Editor
                height="100%"
                language="ncgcode"
                theme={resolvedTheme === "light" ? "nc-light" : (resolvedTheme === "navy" ? "nc-dark" : "nc-x-dark")}
                value={code}
                onMount={onEditorMount}
                onChange={(v) => setCode(v ?? "")}
                options={{ minimap: { enabled: false }, fontSize: 13, folding: true, glyphMargin: true, smoothScrolling: true, lineNumbers: "on" }}
              />
            ) : (
              <textarea
                style={{
                  width: "100%",
                  height: "100%",
                  resize: "none",
                  border: "none",
                  outline: "none",
                  background: resolvedTheme === "light" ? "#ffffff" : (resolvedTheme === "navy" ? "#0f172a" : "#16181c"),
                  color: resolvedTheme === "light" ? "#0f172a" : "#e7e9ea",
                  fontFamily: "Consolas, Monaco, 'Courier New', monospace",
                  fontSize: 13,
                  lineHeight: 1.45,
                  padding: 12,
                }}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </section>
          )}

          {immersiveViewer && showEditor && (
            <div
              className="splitter immersive-splitter"
              style={immersiveEditorSplitterStyle}
              onPointerDown={(e) => startDrag(e, "editor", editorWidth)}
            />
          )}

          {!immersiveViewer && showEditor && showViewer && (
            <div className="splitter" onPointerDown={(e) => startDrag(e, "editor", editorWidth)} />
          )}

          {showImmersiveViewerPane && (
          <section className={`viewer-pane panel${immersiveViewer ? " immersive-viewer-pane" : ""}`} style={{ flex: "1 1 auto" }}>
            <h3>{t("viewer")}</h3>
            <div className={`viewer-float-actions${immersiveViewer ? " immersive" : ""}`}>
              <button
                className={`icon-btn viewer-float-btn viewer-float-btn-halo${immersiveViewer ? " active" : ""}`}
                data-ui-tooltip={immersiveViewerTooltip}
                onClick={toggleImmersiveViewerMode}
                aria-label={immersiveViewer ? t("exitImmersiveViewer") : t("enterImmersiveViewer")}
              >
                <span className="viewer-float-btn-icon-shell">
                  {immersiveViewer ? <Shrink size={16} strokeWidth={2.1} /> : <Expand size={16} strokeWidth={2.1} />}
                </span>
              </button>
            </div>
            <Viewer3D
              key={activeFile || loadedProgram?.fileName || "viewer-default"}
              frames={frames}
              codeLines={codeLines}
              currentFrame={currentFrame}
              hoverFrame={hoverFrame}
              cameraState={cameraState}
              theme={resolvedTheme}
              interactionMode={interactionMode}
              showGrid={showGrid}
              showOrientationGizmo={showOrientationGizmo}
              showRapidPath={showRapidPath}
              showPathTooltip={showPathTooltip}
              refocusNonce={refocusNonce}
              zoomRequestNonce={viewerZoomRequest.nonce}
              zoomRequestScale={viewerZoomRequest.scale}
              onRefocusApplied={handleViewerRefocusApplied}
              onRequestNamedView={handleViewerRequestNamedView}
              onViewerHotkeyScopeChange={setViewerHotkeyScope}
              // Keep camera stable across hide/show and file switches; avoid secondary auto-fit jitter.
              fitOnResize={false}
              onCameraStateChange={handleViewerCameraStateChange}
              onFrameHover={handleViewerFrameHover}
              onFrameHoverEnd={handleViewerFrameHoverEnd}
              onFramePick={handleViewerFramePick}
            />
            <div className="viewer-meta">
              <div className="viewer-legend" title={legendTooltipText}>
                <span className="legend-item"><b>{t("legendLineNo")}:</b> {currentFrame?.lineNumber ?? "-"}</span>
                <span className="legend-item">
                  <span className="legend-dot cut" />
                  {t("legendLine")}
                </span>
                <span className="legend-item">
                  <span className="legend-dot curve" />
                  {t("legendCurve")}
                </span>
                <span className="legend-item">
                  <span className="legend-dot rapid" />
                  {t("legendRapid")}
                </span>
                <span className="legend-item">
                  <span className="legend-dot plunge" />
                  {t("legendPlunge")}
                </span>
                <span className="legend-item">
                  <span className="legend-dot selected" />
                  {t("legendSelected")}
                </span>
                {ncMode === "laser" && (
                  <span className="legend-item">
                    <span className="legend-dot uvw" />
                    {t("legendUvw")}
                  </span>
                )}
                <span className="legend-item legend-current-code" title={currentNcLineText}>
                  <b>{t("currentCode")}:</b> {currentNcLineText}
                </span>
              </div>
              <div className="viewer-progress">
                <label htmlFor="viewer-progress">{t("progress")}</label>
                <input
                  id="viewer-progress"
                  className="viewer-progress-range"
                  type="range"
                  min={0}
                  max={Math.max(0, frames.length - 1)}
                  step={0.01}
                  value={Math.max(0, Math.min(frames.length - 1, playProgress))}
                  style={{
                    "--progress-pct": `${frames.length > 1
                      ? (Math.max(0, Math.min(frames.length - 1, playProgress)) / (frames.length - 1)) * 100
                      : 0}%`,
                  } as CSSProperties}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const idx = Math.max(0, Math.min(frames.length - 1, Math.round(raw)));
                    updatePlayProgress(raw, true);
                    setPathNavActive(true);
                    setHoverFrame(null);
                    selectFrameByIndex(idx);
                  }}
                  disabled={frames.length < 2}
                />
                <span>{Math.min(frames.length, (currentFrame?.index ?? 0) + 1)} / {frames.length}</span>
              </div>
            </div>
          </section>
          )}
        </div>
      </main>

      {showShortcutModal && (
        <div className="modal-mask" onClick={() => setShowShortcutModal(false)}>
          <div className="shortcut-modal" onClick={(e) => e.stopPropagation()}>
            <div className="shortcut-modal-head">
              <div className="shortcut-modal-title">
                <h4>{t("shortcutMapping")}</h4>
                <p>{t("shortcutMappingDesc")}</p>
              </div>
              <button className="modal-close-btn" onClick={() => setShowShortcutModal(false)} data-ui-tooltip={t("close")} aria-label={t("close")}>
                <X size={14} />
              </button>
            </div>
            <div className="shortcut-modal-body">
              <div className="shortcut-groups">
                {shortcutGroups.map((group) => (
                  <section key={group.id} className="shortcut-card">
                    <div className="shortcut-card-head">
                      <div>
                        <h5>{group.title}</h5>
                        <p>{group.description}</p>
                      </div>
                      <span className="shortcut-card-count">{group.items.length}</span>
                    </div>
                    <div className="shortcut-card-items">
                      {group.items.map((item) => (
                        <div key={item.id} className="shortcut-item">
                          <span className="shortcut-item-label">{item.label}</span>
                          <button
                            type="button"
                            className={`shortcut-chip${recordingShortcutId === item.id ? " recording" : ""}${shortcutConflicts[item.id]?.length ? " conflict" : ""}`}
                            onClick={() => setRecordingShortcutId(item.id)}
                            onKeyDown={(e) => onShortcutRecorderKeyDown(item.id, e)}
                          >
                            {recordingShortcutId === item.id
                              ? t("shortcutRecording")
                              : (displayShortcut(shortcuts[item.id]) || t("shortcutUnset"))}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
            <div className="shortcut-modal-foot">
              <span className={`shortcut-modal-hint${shortcutConflictMessage ? " conflict" : ""}`}>
                {shortcutConflictMessage || t("shortcutInputHint")}
              </span>
              <button className="menu-btn" onClick={() => setShortcuts(defaultShortcuts)}>{t("resetDefault")}</button>
            </div>
          </div>
        </div>
      )}

      <footer className="status-bar">
        <span>{status}</span>
        <span>{activeFile ? basename(activeFile) : "-"}</span>
        <span>{frames.length} path points</span>
      </footer>
    </div>
  );
}

export default App;
