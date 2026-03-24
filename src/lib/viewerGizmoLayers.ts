export function getGizmoHaloMaterialProps() {
  return {
    depthTest: true,
    depthWrite: false,
    transparent: true,
    renderOrder: 1,
  } as const;
}

export function getGizmoAxisMaterialProps() {
  return {
    depthTest: false,
    depthWrite: false,
    transparent: true,
    renderOrder: 10,
  } as const;
}
