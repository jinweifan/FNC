import type { ShortcutId } from "./shortcuts";

export type ShortcutGroup = {
  id: "file" | "panels" | "viewer" | "path";
  itemIds: ShortcutId[];
};

export function getShortcutGroups(): ShortcutGroup[] {
  return [
    {
      id: "file",
      itemIds: ["openShortcuts", "openNc", "saveFile", "saveFileAs"],
    },
    {
      id: "panels",
      itemIds: ["toggleFiles", "toggleEditor", "toggleViewer", "toggleImmersiveViewer"],
    },
    {
      id: "viewer",
      itemIds: ["refocus", "viewTop", "viewFront", "viewLeft", "viewRight", "viewBottom", "panMode", "rotateMode", "zoomIn", "zoomOut", "toggleGrid", "toggleGizmo", "toggleRapidPath", "togglePathTooltip"],
    },
    {
      id: "path",
      itemIds: ["pathPrev", "pathNext"],
    },
  ];
}
