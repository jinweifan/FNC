# 3D Memory Optimization Design

**Date:** 2026-03-25

**Goal**

Optimize release-build 3D memory usage for the NC playback experience without changing visible behavior, interaction semantics, or playback smoothness. Prioritize reducing retained frontend objects during playback and improving post-playback memory recovery.

## Problem Summary

Current memory behavior suggests that playback-time state updates still keep too much 3D-derived data live in the WebView process. Earlier optimizations reduced duplicated loaded-program state and some transient allocations, but release-mode playback can still show significant growth and insufficient recovery after playback stops.

The highest-risk area is the `Viewer3D` data flow around:
- `currentFrame` / `playProgress` high-frequency updates
- derived render buffers (`cut`, `rapid`, `uvw`, `plunge`)
- pick segment collections and focus/hover segment overlays
- camera / hover / picked-segment state holding onto geometry-adjacent objects longer than needed

## Constraints

- Do not change feature behavior.
- Do not degrade playback smoothness.
- Do not reduce picking accuracy or break code-editor linkage.
- Prefer structural retention fixes over render-quality downgrades.
- Validate with targeted tests plus build / cargo checks.

## Recommended Approach

### 1. Isolate playback-agnostic scene data

Move large derived scene data farther away from playback-driven state so `currentFrame` updates do not cause avoidable re-derivation or re-retention.

Focus:
- segment classification output
- line point buffers
- pick segment arrays
- geometry-center / scene-scale inputs that only depend on frames or code lines

### 2. Reduce duplicate retained collections

Audit where the same logical path data is being held in multiple representations at once:
- render arrays
- pick arrays
- focus arrays
- hover payloads

Where possible, reuse stable source records and derive the smallest possible overlay payloads for hover/focus, instead of keeping multiple larger object graphs live.

### 3. Clear post-playback sticky references

After playback stops or source data changes, ensure temporary selection/hover/focus/camera-adjacent references do not keep old playback data reachable longer than necessary.

Focus:
- `hoverFrame`
- `pickedSegment`
- `hoverInfo`
- focus segment point arrays
- any playback RAF or timer-linked refs that can extend object lifetime

## Expected Changes

- `Viewer3D` should hold a smaller set of stable long-lived scene structures.
- Playback should update only the minimum dynamic overlay state.
- Stopping playback or switching files should release more memory pressure promptly.
- Release-build memory should become more stable during playback and lower at steady state.

## Validation Strategy

1. Add small targeted tests for new pure helpers or retention-oriented decomposition.
2. Run existing viewer-related unit tests.
3. Run `npm run build`.
4. Run `cargo check --manifest-path /Users/reddyfan/code/FNC/src-tauri/Cargo.toml`.
5. Rebuild release package only after code verification passes.

## Out of Scope

- Dynamic DPR or quality downgrade strategies.
- Major renderer/library replacement.
- Functionality changes to playback, picking, or camera behavior.
- Multi-workspace persistence changes unrelated to 3D memory.
