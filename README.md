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

## 快速开始（开发）

```bash
pnpm install
pnpm dev
```

开发模式会同时启动 Vite 与 Electron。请确认 Docker 可访问。

## 常用脚本

```bash
# 类型检查
pnpm typecheck

# 构建（renderer + electron main/preload）
pnpm build

# 测试（Vitest）
pnpm test

# 产物打包
pnpm dist
```

## 打包与发布

### 本地打包

```bash
pnpm dist
```

- 输出目录由 `electron-builder.json` 的 `directories.output` 定义（默认：`release/<version>`）。
- Windows 产物：NSIS 安装包（`.exe`）。
- macOS 产物：`.dmg` 与 `.zip`（需在 macOS 环境构建）。

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

- 推送 tag `v*`（例如 `v0.1.0`）会触发 `.github/workflows/release.yml`。
- 工作流会自动将 tag 同步到 `package.json.version`（通过 `scripts/sync-version-from-tag.mjs`）。
- 构建并上传安装包到 GitHub Release。

## 项目结构（简）

```text
src/                # 渲染进程（React UI）
electron/main/      # Electron 主进程与 Docker IPC
electron/preload/   # 安全桥接 API（window.dockerDesktop）
shared/             # 前后端共享类型与常量
scripts/            # 构建/发布辅助脚本
```

## 故障排查

- **macOS 无法打开应用**：见上文 **「macOS：无法安装或提示「已损坏」」** 小节，或阅读 [docs/macOS-install-troubleshooting.md](docs/macOS-install-troubleshooting.md)。
- **无法连接 Docker**：确认 Docker 已启动，并检查 `DOCKER_HOST` 等变量是否正确。
- **Compose 创建失败**：当前 Compose 页使用临时目录写入 `compose.yaml`；依赖复杂相对路径/多文件构建上下文时，建议在项目目录终端执行。
- **容器终端无输出**：检查容器状态与 shell 可用性（如 `sh`/`bash`）。

## License

**MIT**，全文见 [LICENSE](LICENSE)；著作权人为 **Guo's**。
