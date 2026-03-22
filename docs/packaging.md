# FNCViewer 打包文档

本文说明如何打包不同操作系统可直接运行的安装包与应用包。

## 1. 目标产物

- Windows x64：`NSIS + MSI`
- Ubuntu x64：`AppImage + DEB`
- macOS Apple Silicon：`APP + DMG`

## 2. 本地打包前准备

在仓库根目录执行：

```bash
npm ci
```

确保：

- Node.js 与 npm 可用
- Rust 与 cargo 可用
- Tauri CLI 可用

若是通过 `rustup` 安装 Rust，请确保 shell 已加载：

```bash
source "$HOME/.cargo/env"
```

## 3. Windows x64 打包

### 3.1 命令

```bash
npm run tauri:build:win
```

### 3.2 产物目录

- `src-tauri/target/release/bundle/nsis`
- `src-tauri/target/release/bundle/msi`

### 3.3 常见问题

- 若出现 NSIS/WiX 下载超时：通常是外网网络问题，可重试或改用 CI。
- 可先生成可执行文件兜底：

```bash
npm run tauri -- build --no-bundle
```

产物：

- `src-tauri/target/release/fncviewer.exe`

## 4. Ubuntu x64 打包

说明：建议在 Linux 机器或 Linux CI 上执行。

### 4.1 命令

```bash
npm run tauri:build:linux
```

### 4.2 产物目录

- `src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage`
- `src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb`

### 4.3 Linux 依赖（Ubuntu runner）

示例依赖：

- `libwebkit2gtk-4.1-dev`
- `libappindicator3-dev`
- `librsvg2-dev`
- `patchelf`

首次环境可执行：

```bash
curl https://sh.rustup.rs -sSf | sh -s -- -y
source "$HOME/.cargo/env"
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf build-essential pkg-config
```

若出现以下错误：

- `failed to run 'cargo metadata' ... No such file or directory (os error 2)`

处理方式：

1. 先执行 `source "$HOME/.cargo/env"`
2. 运行 `cargo --version`，确认可见
3. 再执行 `npm run tauri:build:linux`

## 5. macOS Apple Silicon 打包

说明：建议在 macOS Apple Silicon 机器或 macOS ARM CI 上执行。

### 5.1 命令

```bash
npm run tauri:build:mac:arm
```

### 5.2 产物目录

- `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg`
- `src-tauri/target/aarch64-apple-darwin/release/bundle/macos`

## 6. GitHub Actions 三端打包

已配置工作流：

- `.github/workflows/desktop-build.yml`

### 6.1 触发方式

- 手动触发：GitHub Actions 页面点击 `Build Desktop Installers`
- Tag 触发：推送 `v*` 版本标签

### 6.2 CI 输出 artifact

- `fnc-windows-x64`
- `fnc-linux-x64`
- `fnc-macos-intel`
- `fnc-macos-apple-silicon`

## 8. 常见打包报错补充

- Windows `os error 5`（failed to remove fncviewer.exe）：
  关闭正在运行的 FNCViewer，再打包；必要时换一个新的 `CARGO_TARGET_DIR`。
- NSIS 下载超时（`timeout: global`）：
  网络问题，重试或改用 GitHub Actions 打包。

## 7. 发布建议

- 本地验证功能后再打包
- 安装包命名包含版本号与平台
- 每个版本至少验证以下流程：
  - 启动
  - 打开文件
  - 编辑保存
  - 3D 联动
  - 导出
