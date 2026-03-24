import test from "node:test";
import assert from "node:assert/strict";
import { getGizmoAxisMaterialProps, getGizmoHaloMaterialProps } from "./viewerGizmoLayers.ts";

test("gizmo axis material props stay above halo props", () => {
  const halo = getGizmoHaloMaterialProps();
  const axis = getGizmoAxisMaterialProps();

  assert.equal(halo.depthTest, true);
  assert.equal(axis.depthTest, false);
  assert.equal(axis.renderOrder > halo.renderOrder, true);
});
