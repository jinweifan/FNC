# FNCViewer 打包与安装文档

本文档覆盖以下内容：
- Windows x64 打包（NSIS + MSI）
- Ubuntu x64 打包（AppImage + DEB）
- Ubuntu 安装与运行（详细）
- 常见问题排查（含你当前环境中出现过的问题）

## 1. 目标产物

- Windows x64：`nsis` + `msi`
- Ubuntu x64：`AppImage` + `deb`
- macOS Apple Silicon：`app` + `dmg`（需在 macOS 主机构建）

## 2. 构建前准备

在仓库根目录执行：

```bash
npm ci
```

并确保：
- `node -v`、`npm -v` 可用
- `cargo --version` 可用
- `tauri -V` 可用（或 `npm run tauri -- -V`）

若 `cargo` 不可用（Linux/macOS）：

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

### 3.3 常见错误

1. `failed to remove ... fncviewer.exe (os error 5)`
- 原因：程序正在运行占用文件。
- 处理：先关闭 FNCViewer（必要时结束进程），再重试打包。

2. NSIS/WiX 下载超时
- 原因：网络问题。
- 处理：重试或使用 CI 构建。

## 4. Ubuntu x64 打包

说明：推荐在 Ubuntu 主机或 Docker Linux 容器中执行。

### 4.1 直接在 Ubuntu 主机打包

```bash
npm ci
source "$HOME/.cargo/env"
npm run tauri -- build --target x86_64-unknown-linux-gnu --bundles appimage,deb
```

### 4.2 使用仓库 Docker 打包（Windows 主机推荐）

```powershell
# 在仓库根目录
powershell -ExecutionPolicy Bypass -File .\docker\build-linux-in-docker.ps1
```

如需 Ubuntu 22.04（Jammy）兼容优先镜像，可手动执行：

```powershell
docker build -f .\docker\linux-builder-jammy.Dockerfile -t fncviewer-linux-builder:jammy .
docker run --rm -v "${PWD}:/work" -w /work fncviewer-linux-builder:jammy bash -lc "npm ci && npm run tauri -- build --target x86_64-unknown-linux-gnu --bundles appimage,deb"
```

### 4.3 产物目录

- `src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage/FNCViewer_0.1.0_amd64.AppImage`
- `src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/FNCViewer_0.1.0_amd64.deb`

## 5. Ubuntu 安装与运行（详细）

### 5.1 推荐安装方式：DEB

先确保系统源可访问：

```bash
sudo apt update
```

安装包：

```bash
cd ~/Downloads
sudo apt install ./FNCViewer_0.1.0_amd64.deb
```

安装后启动：

```bash
fnc-viewer
```

或在应用菜单中搜索 `FNCViewer`。

### 5.2 备用方式：AppImage

```bash
cd ~/Downloads
chmod +x ./FNCViewer_0.1.0_amd64.AppImage
./FNCViewer_0.1.0_amd64.AppImage
```

## 6. Ubuntu 常见问题排查（精确版）

### 6.1 `暂时不能解析域名 mirrors.ustc.edu.cn`

这是系统 DNS/网络问题，不是 FNCViewer 包本身问题。

处理顺序：

```bash
# 1) 检查网络
ping -c 3 8.8.8.8
ping -c 3 mirrors.ustc.edu.cn

# 2) 更新索引
sudo apt update

# 3) 再安装
sudo apt install ./FNCViewer_0.1.0_amd64.deb
```

若公司/校园网有限制，建议切换可用镜像源或先修复 DNS。

### 6.2 安装 DEB 时出现 `dkms` / `virtualbox` 失败

你日志中的错误属于系统内核模块（VirtualBox DKMS）编译失败，与 FNCViewer 功能无直接关系。

可先修复系统包状态：

```bash
sudo dpkg --configure -a
sudo apt -f install
```

然后再次执行：

```bash
sudo apt install ./FNCViewer_0.1.0_amd64.deb
```

### 6.3 AppImage 报 WebKit/渲染相关错误

优先建议使用 `deb` 安装方式（最稳）。

若必须使用 AppImage，可尝试：

```bash
LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 GDK_BACKEND=x11 ./FNCViewer_0.1.0_amd64.AppImage
```

注意：以上环境变量可能导致明显卡顿，仅用于临时兼容。

### 6.4 双击 `.nc/.anc` 关联打开

安装 DEB 后可在系统“默认应用”中把 `.nc/.anc` 关联到 `FNCViewer`。

若关联后未加载内容，请确认：
- 文件后缀为 `.nc` 或 `.anc`
- 文件可读权限正常
- 启动的是打包版应用（不是浏览器开发地址）

## 7. 验证清单（建议）

安装后建议先用示例文件验证：
- 仓库 `demo_nc/` 下的 `.nc/.anc`

检查点：
- 文件打开与文件列表切换
- 代码编辑器与 3D 联动
- 进度条拖动与播放
- 网格开关（默认首次启动为开启）
- 主题/语言切换

## 8. 发布建议

- 本地通过验证后再发包
- 产物文件名带版本号
- Windows 与 Ubuntu 分别做一次冷启动验证
