# 3D Memory Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce release-build 3D playback memory retention by isolating playback-agnostic scene data, shrinking duplicate retained collections, and clearing sticky playback references without changing behavior or playback smoothness.

**Architecture:** Keep `Viewer3D` focused on dynamic playback overlays and interaction state, while moving stable scene derivation into pure helpers with smaller outputs. Reuse stable segment records and lightweight point buffers so playback updates do not retain parallel object graphs. Clean up selection/hover/focus state when playback or source data changes so old scene objects become unreachable sooner.

**Tech Stack:** React, TypeScript, Tauri, Three.js, @react-three/fiber, @react-three/drei, Node test runner.

---

### Task 1: Split stable scene payload from dynamic overlays

**Files:**
- Create: `/Users/reddyfan/code/FNC/src/lib/viewerSceneData.ts`
- Test: `/Users/reddyfan/code/FNC/src/lib/viewerSceneData.test.ts`
- Modify: `/Users/reddyfan/code/FNC/src/components/Viewer3D.tsx`

- [ ] **Step 1: Write the failing test**

Create `/Users/reddyfan/code/FNC/src/lib/viewerSceneData.test.ts` to assert that a single helper can derive:
- stable `segmentData`
- sampled/full pick segment lists
- stable render point buffers
- scene bounds metadata (`sceneScale`, `geometryCenter`)

The test should verify that changing only playback flags such as `showRapidPath` or pointer state does not rebuild unrelated scene outputs.

- [ ] **Step 2: Run test to verify it fails**

Run:
`node --test --experimental-strip-types /Users/reddyfan/code/FNC/src/lib/viewerSceneData.test.ts`

Expected: FAIL because `viewerSceneData.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `/Users/reddyfan/code/FNC/src/lib/viewerSceneData.ts` with small pure helpers that:
- build stable segment data from `frames` + `codeLines`
- compute sampled pick lists from stable segments
- compute line buffers from stable segments
- compute scene bounds once from `framesForCenter(frames)`

Keep the return shape focused and serializable where possible; prefer plain objects and number arrays over `Vector3` instances.

- [ ] **Step 4: Wire `Viewer3D` to the helper**

Update `/Users/reddyfan/code/FNC/src/components/Viewer3D.tsx` so its large scene derivations come from `viewerSceneData.ts`, keeping `currentFrame`, `hoverFrame`, `pickedSegment`, and camera sync as the primary dynamic inputs.

- [ ] **Step 5: Run test to verify it passes**

Run:
`node --test --experimental-strip-types /Users/reddyfan/code/FNC/src/lib/viewerSceneData.test.ts /Users/reddyfan/code/FNC/src/lib/viewerSegments.test.ts /Users/reddyfan/code/FNC/src/lib/viewerLinePoints.test.ts`

Expected: PASS.

### Task 2: Shrink focus and hover retained payloads

**Files:**
- Create: `/Users/reddyfan/code/FNC/src/lib/viewerHoverInfo.ts`
- Test: `/Users/reddyfan/code/FNC/src/lib/viewerHoverInfo.test.ts`
- Modify: `/Users/reddyfan/code/FNC/src/lib/viewerFocusSegment.ts`
- Modify: `/Users/reddyfan/code/FNC/src/components/Viewer3D.tsx`

- [ ] **Step 1: Write the failing tests**

Add tests that cover:
- focus segment resolution returns the minimum useful point payload for the marker frame
- hover info derivation depends only on the hovered segment and code line text
- no helper requires retaining large `frames`-adjacent objects beyond what is needed for display

- [ ] **Step 2: Run tests to verify they fail**

Run:
`node --test --experimental-strip-types /Users/reddyfan/code/FNC/src/lib/viewerHoverInfo.test.ts /Users/reddyfan/code/FNC/src/lib/viewerFocusSegment.test.ts`

Expected: FAIL because the new hover helper does not exist yet and/or assertions do not yet hold.

- [ ] **Step 3: Write minimal implementation**

- Extract hover tooltip formatting into `/Users/reddyfan/code/FNC/src/lib/viewerHoverInfo.ts`
- Refactor `/Users/reddyfan/code/FNC/src/lib/viewerFocusSegment.ts` so it returns the smallest useful point set for highlight rendering
- Keep outputs as plain vectors / primitive fields until the render boundary

- [ ] **Step 4: Update `Viewer3D` usage**

In `/Users/reddyfan/code/FNC/src/components/Viewer3D.tsx`:
- reduce `useMemo` work that rebuilds `Vector3[]`
- construct `Vector3` instances only where Drei/Three rendering strictly needs them
- ensure hover/focus state stores only narrow payloads

- [ ] **Step 5: Run tests to verify they pass**

Run:
`node --test --experimental-strip-types /Users/reddyfan/code/FNC/src/lib/viewerHoverInfo.test.ts /Users/reddyfan/code/FNC/src/lib/viewerFocusSegment.test.ts /Users/reddyfan/code/FNC/src/lib/viewerPick.test.ts`

Expected: PASS.

### Task 3: Release sticky references on playback/source transitions

**Files:**
- Create: `/Users/reddyfan/code/FNC/src/lib/viewerPlaybackState.ts`
- Test: `/Users/reddyfan/code/FNC/src/lib/viewerPlaybackState.test.ts`
- Modify: `/Users/reddyfan/code/FNC/src/components/Viewer3D.tsx`
- Modify: `/Users/reddyfan/code/FNC/src/App.tsx`

- [ ] **Step 1: Write the failing tests**

Create tests for helper logic that determines when to clear transient viewer state:
- switching source frames should invalidate stale picked/hovered segment state
- stopping playback should clear only transient overlays, not user preferences or camera state
- changing files should reset stale frame-linked references safely

- [ ] **Step 2: Run tests to verify they fail**

Run:
`node --test --experimental-strip-types /Users/reddyfan/code/FNC/src/lib/viewerPlaybackState.test.ts`

Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `/Users/reddyfan/code/FNC/src/lib/viewerPlaybackState.ts` with pure guards for:
- stale segment detection
- safe reset rules for hover / pick / focus-adjacent state
- file/playback transition checks

- [ ] **Step 4: Wire cleanup behavior**

Update `/Users/reddyfan/code/FNC/src/components/Viewer3D.tsx` and `/Users/reddyfan/code/FNC/src/App.tsx` to clear stale transient state when:
- file data changes
- frame arrays change materially
- playback stops or seeks to invalid references

Do not change camera persistence or toolbar preference persistence.

- [ ] **Step 5: Run tests to verify they pass**

Run:
`node --test --experimental-strip-types /Users/reddyfan/code/FNC/src/lib/viewerPlaybackState.test.ts /Users/reddyfan/code/FNC/src/lib/workspaceSession.test.ts`

Expected: PASS.

### Task 4: Run full targeted verification

**Files:**
- Modify only if needed from previous tasks
- Test: `/Users/reddyfan/code/FNC/src/lib/viewerSceneData.test.ts`
- Test: `/Users/reddyfan/code/FNC/src/lib/viewerHoverInfo.test.ts`
- Test: `/Users/reddyfan/code/FNC/src/lib/viewerPlaybackState.test.ts`
- Test: existing viewer/lib tests under `/Users/reddyfan/code/FNC/src/lib/`

- [ ] **Step 1: Run viewer-focused unit tests**

Run:
`node --test --experimental-strip-types /Users/reddyfan/code/FNC/src/lib/viewerSceneData.test.ts /Users/reddyfan/code/FNC/src/lib/viewerHoverInfo.test.ts /Users/reddyfan/code/FNC/src/lib/viewerPlaybackState.test.ts /Users/reddyfan/code/FNC/src/lib/viewerFocusSegment.test.ts /Users/reddyfan/code/FNC/src/lib/viewerPick.test.ts /Users/reddyfan/code/FNC/src/lib/viewerLinePoints.test.ts /Users/reddyfan/code/FNC/src/lib/viewerSegments.test.ts /Users/reddyfan/code/FNC/src/lib/viewer3dProps.test.ts`

Expected: PASS.

- [ ] **Step 2: Run production build**

Run:
`cd /Users/reddyfan/code/FNC && npm run build`

Expected: PASS.

- [ ] **Step 3: Run Rust verification**

Run:
`cargo check --manifest-path /Users/reddyfan/code/FNC/src-tauri/Cargo.toml`

Expected: PASS.

- [ ] **Step 4: Release rebuild (only after verification passes)**

Run:
`cd /Users/reddyfan/code/FNC && npm run tauri:build:mac:arm`

Expected: successful arm64 package build with unchanged behavior and reduced 3D playback memory retention.
