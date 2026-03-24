import type { ShortcutId } from "./shortcuts";

export type ShortcutGroup = {
  id: "panels" | "viewer" | "path";
  itemIds: ShortcutId[];
};

export function getShortcutGroups(): ShortcutGroup[] {
  return [
    {
      id: "panels",
      itemIds: ["toggleFiles", "toggleEditor", "toggleViewer"],
    },
    {
      id: "viewer",
      itemIds: ["toggleImmersiveViewer", "refocus", "panMode", "rotateMode", "zoomIn", "zoomOut", "toggleGrid", "toggleGizmo", "toggleRapidPath"],
    },
    {
      id: "path",
      itemIds: ["pathPrev", "pathNext"],
    },
  ];
}
