# First NC Viewer 开发文档

## 1. 开发环境要求

- Node.js 20+
- npm 10+
- Rust stable
- Tauri CLI 2.x

Windows 推荐先确认：

- `cargo` 可用
- WebView2 运行时可用

## 2. 初始化

```bash
npm ci
```

## 3. 本地开发

### 3.1 前端调试

```bash
npm run dev
```

### 3.2 Tauri 桌面调试

```bash
npm run tauri:dev
```

## 4. 构建与校验

```bash
npm run build
cd src-tauri
cargo check
```

## 5. 代码规范

- 前端：TypeScript + ESLint
- Rust：`cargo check` 通过为最低门槛
- 变更要求：
  - 功能代码 + 文档同步
  - UI 变更至少覆盖浅色/深色两种主题
  - 交互变更需验证快捷键和鼠标行为

## 6. 关键开发约定

- 文件打开逻辑统一走 `loadNcFileWithFolderContext`
- 3D 与编辑器联动以 `FrameState.lineNumber` 为主键
- 新增快捷键需同步：
  - `ShortcutId`
  - `defaultShortcuts`
  - 快捷键面板文案
- 新增可持久化设置需同步：
  - `STORAGE_*` 常量
  - 读写 `localStorage`

## 7. 常见问题排查

### 7.1 `cargo metadata program not found`

原因：Rust 工具链未安装。  
处理：安装 Rust 并确认 `cargo --version`。

Linux/macOS 若已安装但仍报错，先执行：

```bash
source "$HOME/.cargo/env"
cargo --version
```

再执行打包命令。

### 7.2 关闭窗口失败（权限报错）

检查 `src-tauri/capabilities/default.json` 权限配置与前端关闭逻辑是否一致。

### 7.3 双击 `.nc/.anc` 启动未自动打开文件

检查：

- OS 是否将该扩展绑定到 First NC Viewer
- 启动参数是否传入（Rust `get_launch_nc_file`）

### 7.4 打包安装包超时

通常是外网下载 NSIS/WiX 等依赖失败。可改用 CI 打包或重试网络环境。

## 8. 提交建议

- 单功能单提交
- 提交信息示例：
  - `feat(viewer): add grid toggle with shortcut`
  - `fix(close): avoid window destroy permission failure`
  - `docs: update packaging guide`
