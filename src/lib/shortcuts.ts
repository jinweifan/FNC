export type ShortcutId =
  | "openShortcuts"
  | "openNc"
  | "saveFile"
  | "saveFileAs"
  | "toggleFiles"
  | "toggleEditor"
  | "toggleViewer"
  | "toggleImmersiveViewer"
  | "refocus"
  | "viewTop"
  | "viewFront"
  | "viewLeft"
  | "viewRight"
  | "viewBottom"
  | "panMode"
  | "rotateMode"
  | "zoomIn"
  | "zoomOut"
  | "toggleGrid"
  | "toggleGizmo"
  | "toggleRapidPath"
  | "togglePathTooltip"
  | "pathPrev"
  | "pathNext";

export type ShortcutMap = Record<ShortcutId, string>;

export function isApplePlatform(platformLike: string | undefined): boolean {
  if (!platformLike) return false;
  const value = platformLike.toLowerCase();
  return value.includes("mac") || value.includes("iphone") || value.includes("ipad");
}

export function getDefaultShortcuts(platformLike?: string): ShortcutMap {
  const primary = isApplePlatform(platformLike) ? "Meta" : "Ctrl";
  const secondary = isApplePlatform(platformLike) ? "Meta" : "Alt";
  return {
    openShortcuts: `${primary}+K`,
    openNc: `${primary}+O`,
    saveFile: `${primary}+S`,
    saveFileAs: `${primary}+Shift+S`,
    toggleFiles: `${secondary}+1`,
    toggleEditor: `${secondary}+2`,
    toggleViewer: `${secondary}+3`,
    toggleImmersiveViewer: `${secondary}+4`,
    refocus: "F",
    viewTop: "Ctrl+1",
    viewFront: "Ctrl+2",
    viewLeft: "Ctrl+3",
    viewRight: "Ctrl+4",
    viewBottom: "Ctrl+5",
    panMode: "1",
    rotateMode: "2",
    zoomIn: "+",
    zoomOut: "-",
    toggleGrid: "G",
    toggleGizmo: "O",
    toggleRapidPath: "H",
    togglePathTooltip: "L",
    pathPrev: "ArrowUp",
    pathNext: "ArrowDown",
  };
}

export function formatShortcutForDisplay(shortcut: string, isMac: boolean): string {
  if (!shortcut) return "";
  if (!isMac) return shortcut;
  return shortcut.replace(/\bMeta\b/g, "Cmd");
}

export function normalizeShortcut(input: string): string {
  const parts = input
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const normalized = parts.map((part, idx) => {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") return "Ctrl";
    if (lower === "alt" || lower === "option") return "Alt";
    if (lower === "shift") return "Shift";
    if (lower === "meta" || lower === "cmd" || lower === "command" || lower === "win") return "Meta";
    if (lower === "space") return "Space";
    if (lower === "arrowup") return "ArrowUp";
    if (lower === "arrowdown") return "ArrowDown";
    if (lower === "arrowleft") return "ArrowLeft";
    if (lower === "arrowright") return "ArrowRight";
    if (part === "+" || part === "-") return part;
    if (idx === parts.length - 1 && part.length === 1) return part.toUpperCase();
    return part.charAt(0).toUpperCase() + part.slice(1);
  });
  const modifierOrder = ["Ctrl", "Alt", "Shift", "Meta"];
  const modifiers = normalized.filter((p) => modifierOrder.includes(p));
  const key = normalized.find((p) => !modifierOrder.includes(p)) ?? "";
  const orderedMods = modifierOrder.filter((m) => modifiers.includes(m));
  return [...orderedMods, key].filter(Boolean).join("+");
}

export function keyboardEventToShortcut(event: {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  key: string;
}): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey && event.key !== "+") parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  const key = event.key;
  let normalizedKey = key;
  if (key === "+" || (key === "=" && event.shiftKey)) normalizedKey = "+";
  else if (key === " ") normalizedKey = "Space";
  else if (key.length === 1) normalizedKey = key.toUpperCase();
  else if (key === "Esc") normalizedKey = "Escape";
  return normalizeShortcut([...parts, normalizedKey].join("+"));
}

export function isModifierOnlyShortcut(shortcut: string): boolean {
  return shortcut === "Ctrl" || shortcut === "Alt" || shortcut === "Shift" || shortcut === "Meta";
}

export function findShortcutConflicts(shortcuts: ShortcutMap): Partial<Record<ShortcutId, ShortcutId[]>> {
  const shortcutToIds = new Map<string, ShortcutId[]>();
  for (const [id, shortcut] of Object.entries(shortcuts) as Array<[ShortcutId, string]>) {
    if (!shortcut) continue;
    const ids = shortcutToIds.get(shortcut) ?? [];
    ids.push(id);
    shortcutToIds.set(shortcut, ids);
  }

  const conflicts: Partial<Record<ShortcutId, ShortcutId[]>> = {};
  for (const ids of shortcutToIds.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      conflicts[id] = ids.filter((otherId) => otherId !== id);
    }
  }
  return conflicts;
}
