# FNCViewer 技术文档

## 1. 技术架构概览

FNCViewer 采用 Tauri 双层架构：

- 前端层（React/TypeScript）：负责 UI、编辑器、3D 交互、状态管理
- 桌面层（Rust/Tauri）：负责本地文件 IO、命令接口、系统窗口与打包

前后端通过 `invoke(command, payload)` 通信。

## 2. 模块划分

### 2.1 前端模块

- `src/App.tsx`
  - 全局界面编排
  - 文件/最近文件/布局状态
  - 快捷键映射与主题、语言
- `src/components/Viewer3D.tsx`
  - 路径渲染
  - 拾取与 hover/selected 逻辑
  - 视图交互（平移、旋转、缩放）
- `src/lib/ncPath.ts`
  - 文本到帧序列（FrameState）转换
- `src/locales/*.json`
  - 国际化资源

### 2.2 Rust 模块

- `src-tauri/src/lib.rs`
  - 命令定义与注册
  - 文件解析与导出
  - 启动参数读取（双击文件打开）
- `src-tauri/src/main.rs`
  - 入口与窗口子系统设置
- `src-tauri/capabilities/default.json`
  - Tauri 权限定义

## 3. 关键数据结构

- `ParseResult`
  - 文件基础信息
  - 总行数、运动行数、边界框
- `FrameState`
  - 索引、代码行号、坐标、运动类型
  - 模式信息（通用雕刻机 / 激光一体机）
  - 坐标域（`XYZ` / `UVW`）
- `CameraState`
  - 相机位置、目标点、视图名

## 4. 激光一体机模式（核心技术点）

### 4.1 坐标映射规则

- 正面坐标域：`XYZ`
- 反面坐标域：`UVW`
- 映射关系：`U->X`、`V->Y`、`W->Z`
- 方向约定：`W > 0` 等价 `Z` 负方向，`W < 0` 等价 `Z` 正方向

### 4.2 渲染与图例策略

- `UVW` 反面路径使用独立颜色图层渲染
- 非激光一体机模式下不显示 `UVW` 图例项
- 路径类型（直线/曲线/快速移动/下刀段/当前选中）与坐标域颜色叠加显示

### 4.3 联动一致性

- 进度条、编辑器、3D 视图统一以 `FrameState.index` 驱动
- 在激光一体机模式下，`UVW` 路径同样支持拾取、定位、高亮、箭头方向标识

## 5. 核心交互链路

### 5.1 文件打开链路

1. 用户选择文件或双击文件启动
2. 文件列表单击即切换并加载目标文件
3. 同目录文件扫描仅包含 `.nc/.anc`
4. Rust `open_nc_file` 返回 `ParseResult`
5. 前端 `parseNcToFrames` 生成 `FrameState[]`
6. 编辑器与 3D 视图同步刷新

### 5.2 路径联动链路

1. 3D 视图拾取线段
2. 定位对应 `FrameState.lineNumber`
3. 编辑器高亮当前行
4. 进度条更新到对应索引

### 5.3 仿真链路

1. 播放状态机驱动 `playProgress`
2. 按速度推进帧索引
3. 更新当前帧、3D 高亮与编辑器位置

## 6. 主题与样式机制

- CSS 变量驱动主题体系
- 主题 token 覆盖按钮、面板、下拉、进度条、编辑器颜色
- Monaco 自定义主题：
  - `nc-light`
  - `nc-dark`（藏蓝）
  - `nc-x-dark`（深色）

## 7. 性能策略

- 大路径按采样渲染与拾取分层
- UI 更新节流（进度条刷新阈值）
- 视图 resize 时自动 fit 与 center
- 激光一体机模式下按坐标域分层缓存，减少重复重算

## 8. 跨平台兼容策略

- 文件、对话框、窗口：统一使用 Tauri API
- 启动参数加载文件：Rust 统一实现
- 打包：CI 按 OS 维度分别构建

## 9. 错误处理策略

- 非 Tauri 环境 invoke 调用兜底
- 关闭窗口前未保存检查
- 文件读取失败显示用户可理解提示

## 10. 可观测性

- 开发模式启用 `tauri-plugin-log`
- 前端控制台输出用于定位交互与渲染问题
