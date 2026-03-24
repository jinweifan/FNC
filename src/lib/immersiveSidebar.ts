export type ImmersiveSidebarInput = {
  immersiveViewer: boolean;
  showFiles: boolean;
  showEditor: boolean;
  filesWidth: number;
  editorWidth: number;
};

const SIDEBAR_BASE_LEFT = 16;
const SIDEBAR_DRAWER_GAP = 14;

function clampFilesWidth(width: number): number {
  return Math.max(280, Math.min(520, width));
}

function clampEditorWidth(width: number): number {
  return Math.max(360, Math.min(680, width));
}

export function resolveImmersiveSidebarLeft(input: ImmersiveSidebarInput): number {
  if (!input.immersiveViewer) return SIDEBAR_BASE_LEFT;
  if (input.showFiles) return SIDEBAR_BASE_LEFT + clampFilesWidth(input.filesWidth) + SIDEBAR_DRAWER_GAP;
  if (input.showEditor) return SIDEBAR_BASE_LEFT + clampEditorWidth(input.editorWidth) + SIDEBAR_DRAWER_GAP;
  return SIDEBAR_BASE_LEFT;
}
