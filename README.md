# Docker Browser

面向 Docker Engine 的桌面可视化客户端。  
你可以在 GUI 里完成容器、镜像、网络、数据卷的常见管理操作，并支持日志、事件、系统信息查看与容器内终端交互。

仓库地址：<https://github.com/unicorngithub/Docker-Browser>

## 核心特性

| 模块 | 能力 |
|------|------|
| **容器** | 列表/筛选；按 Compose 项目（`com.docker.compose.project`）分组；启动/停止/重启/暂停；右键菜单；独立日志窗口；容器配置重建 |
| **创建容器** | 三种方式：应用内表单、`docker run`、`Dockerfile`，并支持 **Docker Compose**（`compose.yaml` + `up -d`） |
| **容器终端** | PTY 终端交互、复制/粘贴、右键命令建议（按镜像类型给出 hint） |
| **镜像** | 列表、拉取、删除、打标签、历史层信息 |
| **网络/数据卷** | 列表、创建、删除、关联关系查看 |
| **事件** | Docker 事件流订阅（摘要显示） |
| **系统** | 引擎信息、版本、`docker system df`、Compose 版本检测、运行时环境展示 |

## 运行环境

- 已安装并启动 **Docker Engine**（Docker Desktop / Linux Docker）。
- **Node.js 20+**（建议 LTS）。
- **pnpm 9+**。
- Windows / macOS / Linux 开发环境均可（安装包产物当前重点为 Windows、macOS）。

## 连接方式（本地 / 远程）

本应用通过 Docker API 工作，连接行为与本机 Docker CLI 一致：

- 默认连接本机 Docker（例如 Docker Desktop）。
- 若设置了 `DOCKER_HOST` / `DOCKER_CONTEXT`，应用会跟随该配置连接目标引擎。
- 远程 TLS 场景请同时配置 `DOCKER_TLS_VERIFY`、`DOCKER_CERT_PATH` 等环境变量后重启应用。

## 技术栈说明（Tauri 迁移）

> 本分支 `tauri-migration` 将桌面外壳从 **Electron** 迁移到 **Tauri v2**（Rust 后端）。
> 前端（React + Vite + TS）保持不变；原 Node 后端（dockerode / node-pty / child_process）
> 已用 Rust 等价物全量重写：
>
> - Docker API → [`bollard`](https://crates.io/crates/bollard)
> - 交互式终端 → [`portable-pty`](https://crates.io/crates/portable-pty)
> - `docker run/build/compose` 编排 → `tokio::process`
> - 文件对话框 / 外链 / 自动更新 / 多窗口 / 菜单 → Tauri v2 插件与 API
>
> Rust 后端位于 [`src-tauri/`](src-tauri/)。前端通过 [`src/lib/backendBridge.ts`](src/lib/backendBridge.ts)
> 用 `invoke`/`listen` 重建 `window.dockerDesktop` 等对象，方法签名与原 Electron preload 完全一致，
> 返回统一的 `IpcResult<T>`，因此前端调用点零改动。`main` 分支仍保留 Electron 实现。

## 快速开始（开发）

```bash
pnpm install
pnpm dev          # 启动桌面客户端（Vite + Tauri 原生窗口）；请确认 Docker 可访问

# 仅前端调试（浏览器，无后端、无窗口）
pnpm dev:web
```

首次 `pnpm dev` 会编译 Rust 依赖，耗时较长；之后为增量编译。
需要本机 **Rust 工具链**（rustc/cargo）。

## 常用脚本

```bash
# 类型检查
pnpm typecheck

# 构建前端产物（dist/）
pnpm build

# 测试（Vitest）
pnpm test

# 启动桌面客户端 / 打包安装包
pnpm dev
pnpm tauri:build
```

## 打包与发布

### Tauri 打包

```bash
pnpm tauri:build
```

- 产物为各平台原生安装包（macOS `.dmg`/`.app`、Windows `.msi`/NSIS、Linux `.deb`/AppImage），由 `src-tauri/tauri.conf.json` 的 `bundle` 配置。
- **自动更新**：`tauri.conf.json` 的 `plugins.updater` 已内置签名公钥；生成更新包需在构建时提供私钥环境变量
  `TAURI_SIGNING_PRIVATE_KEY`（密钥文件见 `~/.tauri/docker-browser-updater.key`，请妥善保管，勿提交仓库），
  并按需将 `bundle.createUpdaterArtifacts` 置为 `true`、把 `endpoints` 指向实际发布地址。
- 体积显著小于旧 Electron 版（无随包 Node 运行时）。
- Linux 构建需安装 Tauri 系统依赖（`libwebkit2gtk-4.1-dev`、`libgtk-3-dev` 等，见 [Tauri 文档](https://tauri.app/start/prerequisites/)）。

> 旧的 Electron 打包流程（`electron-builder`）已从本分支移除,如需参考请查看 `main` 分支。

### macOS：无法安装或提示「已损坏」

预构建包**未经 Apple 公证**。若提示 **「Docker Browser 已损坏，无法打开」** 或被拦截，多数是 **Gatekeeper / quarantine（下载隔离）**，并非安装包损坏。

**优先**对已安装的 `.app` 清除隔离（路径按实际安装位置修改；应用显示名为 **Docker Browser**）：

```bash
sudo xattr -r -d com.apple.quarantine "/Applications/Docker Browser.app"
```

若安装在 `~/Applications`：

```bash
sudo xattr -r -d com.apple.quarantine ~/Applications/Docker\ Browser.app
```

仍无法打开时，到 **系统设置 → 隐私与安全性** 尝试放行；必要时可临时 `sudo spctl --master-disable`（用毕执行 `sudo spctl --master-enable`）。更细步骤见 [docs/macOS-install-troubleshooting.md](docs/macOS-install-troubleshooting.md)。

从 GitHub Releases 下载时，macOS 建议优先使用 **`.dmg`**，先安装到 **`/Applications`**，再执行上述 `xattr` 命令。

### GitHub Release（CI）

- 推送 tag `v*`（例如 `v0.1.0`）会触发 `.github/workflows/release.yml`，使用 [`tauri-action`](https://github.com/tauri-apps/tauri-action) 在 macOS / Windows / Linux 上打包并创建 GitHub Release。
- 工作流会先用 tag 同步 `package.json.version`（`scripts/sync-version-from-tag.mjs`）；`src-tauri/tauri.conf.json` 的 `version` 也需对应升级。
- 自动更新签名：在仓库 **Secrets** 配置 `TAURI_SIGNING_PRIVATE_KEY`（与 `plugins.updater.pubkey` 对应）及可选 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，并将 `bundle.createUpdaterArtifacts` 置为 `true`。
- 每次推送 / PR 由 `.github/workflows/ci.yml` 跑前端类型检查 + Vitest 与 Rust 编译。

## 项目结构（简）

```text
src/                # 前端（React UI）
src/lib/backendBridge.ts  # invoke/listen 桥，重建 window.dockerDesktop 等
src-tauri/          # Rust 后端（Tauri）
  src/docker/       # Docker 命令：容器/镜像/网络/卷/日志/事件/exec/CLI/文件系统（bollard + portable-pty）
  src/app/          # 应用壳层：窗口/菜单/对话框/主机指标/引擎 bootstrap/更新
shared/             # 前端共享类型与常量（IPC 契约、通道名）
scripts/            # 辅助脚本
```

## 故障排查

- **macOS 无法打开应用**：见上文 **「macOS：无法安装或提示「已损坏」」** 小节，或阅读 [docs/macOS-install-troubleshooting.md](docs/macOS-install-troubleshooting.md)。
- **无法连接 Docker**：确认 Docker 已启动，并检查 `DOCKER_HOST` 等变量是否正确。
- **Compose 创建失败**：当前 Compose 页使用临时目录写入 `compose.yaml`；依赖复杂相对路径/多文件构建上下文时，建议在项目目录终端执行。
- **容器终端无输出**：检查容器状态与 shell 可用性（如 `sh`/`bash`）。

## License

**MIT**，全文见 [LICENSE](LICENSE)；著作权人为 **Guo's**。
