# First NC Viewer 打包文档

本文档统一说明两类打包方式：

- 本地打包：在对应操作系统主机上执行单条命令，产出该系统安装包
- GitHub Actions 打包：一次触发，同时产出 Windows、Ubuntu、macOS 安装包

## 1. 支持的产物

- Windows x64：`NSIS` + `MSI`
- Ubuntu x64：`AppImage` + `DEB`
- macOS Apple Silicon：`app` + `dmg`
- macOS Intel：`app` + `dmg`

## 2. 统一命令入口

仓库使用以下统一打包命令：

```bash
npm run package:linux
npm run package:mac
npm run package:mac:intel
npm run package:win
```

对应关系如下：

- `package:linux` -> `x86_64-unknown-linux-gnu` + `appimage,deb`
- `package:mac` -> `aarch64-apple-darwin` + `app,dmg`
- `package:mac:intel` -> `x86_64-apple-darwin` + `app,dmg`
- `package:win` -> `x86_64-pc-windows-msvc` + `nsis,msi`

说明：

- `macOS` 默认命令是 `npm run package:mac`，即 Apple Silicon 版本
- 不提供误导性的“本地一次产出所有操作系统版本”命令
- 每个命令都要求在对应操作系统主机上执行

## 3. 本地打包前准备

在仓库根目录执行：

```bash
npm ci
```

并确认以下工具可用：

- `node -v`
- `npm -v`
- `cargo --version`

项目打包入口在 [`package.json`](/Users/reddyfan/code/FNC/package.json)，具体分发逻辑在 [`scripts/package-platform.mjs`](/Users/reddyfan/code/FNC/scripts/package-platform.mjs)。

## 4. 本地打包

### 4.1 Ubuntu x64

推荐在 Ubuntu 22.04 或兼容环境执行。

安装系统依赖：

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

构建命令：

```bash
npm ci
npm run package:linux
```

产物目录：

- `src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage`
- `src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb`

### 4.2 macOS Apple Silicon

在 Apple Silicon Mac 上执行：

```bash
npm ci
npm run package:mac
```

产物目录：

- `src-tauri/target/aarch64-apple-darwin/release/bundle/app`
- `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg`

### 4.3 macOS Intel

在 Intel Mac 上执行：

```bash
npm ci
npm run package:mac:intel
```

产物目录：

- `src-tauri/target/x86_64-apple-darwin/release/bundle/app`
- `src-tauri/target/x86_64-apple-darwin/release/bundle/dmg`

### 4.4 Windows x64

在 Windows 主机上执行：

```powershell
npm ci
npm run package:win
```

产物目录：

- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis`
- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi`

## 5. 本地打包限制

- Linux 包请在 Linux 主机上打
- macOS 包请在 macOS 主机上打
- Windows 包请在 Windows 主机上打
- 本仓库不把“交叉编译全部桌面安装包”作为默认工作流

如果在错误的平台上执行命令，[`scripts/package-platform.mjs`](/Users/reddyfan/code/FNC/scripts/package-platform.mjs) 会直接报错并退出。

## 6. GitHub Actions 一键全平台打包

工作流文件：

- [`.github/workflows/desktop-build.yml`](/Users/reddyfan/code/FNC/.github/workflows/desktop-build.yml)

触发方式：

- 手动触发：`workflow_dispatch`
- 发布触发：推送 `v*` tag

矩阵内容：

- `windows-latest` -> `npm run package:win`
- `ubuntu-22.04` -> `npm run package:linux`
- `macos-13` -> `npm run package:mac:intel`
- `macos-14` -> `npm run package:mac`

上传的 artifact 名称：

- `fnc-windows-x64`
- `fnc-linux-x64`
- `fnc-macos-intel`
- `fnc-macos-apple-silicon`

这套工作流的关键约束是：

- CI 与本地共用同一套 npm 打包入口
- GitHub Actions 只负责选择 runner、安装依赖、上传产物
- 具体 Tauri target 与 bundle 参数只在一处定义，即 [`scripts/package-platform.mjs`](/Users/reddyfan/code/FNC/scripts/package-platform.mjs)

## 7. Ubuntu Docker 构建

如果当前主机不是 Linux，但你只想在本地额外产出 Ubuntu x64 包，可以继续使用仓库内 Docker 方案：

```powershell
powershell -ExecutionPolicy Bypass -File .\docker\build-linux-in-docker.ps1
```

对应文件：

- [`docker/build-linux-in-docker.ps1`](/Users/reddyfan/code/FNC/docker/build-linux-in-docker.ps1)
- [`docker/linux-builder.Dockerfile`](/Users/reddyfan/code/FNC/docker/linux-builder.Dockerfile)

说明：

- Docker 方案只覆盖 Linux 包
- 它不是“本地全平台一键打包”

## 8. 常见问题

### 8.1 macOS 能不能在 Linux 或 Windows 上直接打包？

默认不支持，也不作为本仓库标准流程。macOS 包应在 macOS 主机或 `macos` GitHub Actions runner 上构建。

### 8.2 为什么没有 `package:all-supported`？

因为这个名字会误导人以为单台主机能同时生成 Windows、Linux、macOS 全部安装包。实际上标准、安全的桌面打包流程应该按目标操作系统分别构建。

### 8.3 Windows 打包报文件占用错误

若出现类似 `failed to remove ... FirstNCViewer.exe (os error 5)`：

- 先关闭正在运行的 First NC Viewer
- 必要时结束相关进程
- 然后重新执行 `npm run package:win`

### 8.4 Ubuntu 安装 `DEB` 时遇到系统依赖错误

先修复系统包状态：

```bash
sudo dpkg --configure -a
sudo apt -f install
```

然后重新安装：

```bash
sudo apt install ./first-nc-viewer_0.1.0_amd64.deb
```

## 9. 验证建议

打包后建议先用 `demo_nc/` 下的 `.nc/.anc` 文件做冷启动验证，至少检查：

- 文件打开与文件切换
- 代码编辑器和 3D 联动
- 进度条拖动与播放
- 网格开关
- 主题与语言切换
