export type MeasuredEditorViewport = {
  width: number;
  height: number;
};

export type ResolvedEditorViewport = MeasuredEditorViewport & {
  widthStyle: string;
  heightStyle: string;
};

export function resolveMeasuredEditorViewport(
  viewport: MeasuredEditorViewport,
): ResolvedEditorViewport | null {
  const width = Math.max(0, Math.floor(viewport.width));
  const height = Math.max(0, Math.floor(viewport.height));
  if (width <= 0 || height <= 0) return null;
  return {
    width,
    height,
    widthStyle: `${width}px`,
    heightStyle: `${height}px`,
  };
}
