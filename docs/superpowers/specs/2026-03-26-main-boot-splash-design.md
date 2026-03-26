---
title: Main window boot splash (replace startup_splash)
date: 2026-03-26
status: draft
---

## 背景与目标

当前启动流程使用独立的 `startup_splash` 窗口，并在前端首帧（`notify_startup_painted`）或延时关闭。
需求是：**在主界面 React 真正加载出来之前就关闭独立 splash**，同时 **不出现空白/闪白**。

## 方案概述（选定）

将“启动画面”从独立窗口迁移到 **`main` 窗口的静态 boot 层**（HTML/CSS），确保在 React bundle 尚未执行时，
`main` 窗口依然有可见内容。

关键点：

- **`main` 的静态内容**：在 `index.html` 放置 `#boot-splash`，提供背景、标题/Logo、轻量 loading 动画。
- **主题匹配**：静态 CSS 通过 `prefers-color-scheme` 提供暗/亮两套基础配色；JS 启动后仍沿用现有
  `themeBoot` 的精确调色（不改变现有逻辑）。
- **关闭独立 splash 的时机（关键修正）**：不能以 `main.show()` 作为关闭门槛（`show()` 不保证 WebView 已首帧绘制）。
  关闭门槛改为：**`index.html` 的 boot 层已就绪（DOM ready / boot layer inserted）** 后再 `startup_splash.close()`。
  - 建议信号：`index.html` 的极早 inline script 在 `DOMContentLoaded`（或更早）调用一个 tauri command（例如
    `notify_startup_boot_ready`）。
  - **兜底**：保留超时关闭（例如 1s~2s）避免 splash 卡死；并允许 `painted` 作为次级兜底信号。
- **移除 boot 层时机**：React `render(...)` 后的下一到两帧移除/淡出 `#boot-splash`，避免与首帧竞争造成闪烁。

## 启动时序（期望）

1. 应用启动：创建独立 `startup_splash`（短暂）与隐藏的 `main`。
2. 进入 `main`：`main.show()` 时，`index.html` 静态 `#boot-splash` 已可渲染（无空白）。
3. `index.html` boot 就绪信号到达后，关闭独立 `startup_splash`（若信号迟迟不到，走超时兜底关闭）。
4. React 加载并渲染：渲染后移除/淡出 `#boot-splash`，露出完整应用 UI。

## 变更点

- Rust:
  - `notify_startup_ready`: 负责显示 `main`，不再承担“首帧关闭 splash”的语义
  - 新增/复用：接收 boot 就绪信号后关闭 `startup_splash`（并保证幂等）
  - 兜底：保留超时关闭，避免 splash 卡死
- Frontend:
  - `index.html`: 增加 `#boot-splash` 与最小 CSS，并在 DOM ready 时发送 boot 就绪信号
  - `main.tsx`: React mount 后移除/淡出 `#boot-splash`

## 成功标准

- 关闭独立 `startup_splash` 早于 React 首帧。
- `main` 窗口可见期间无“空白/闪白”。
- 主题在暗/亮模式下至少保证背景/文字对比正常（boot 层可简化，但不可刺眼或闪烁）。

