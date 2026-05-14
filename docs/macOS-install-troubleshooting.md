# Docker Browser — macOS 安装与无法打开说明

> **Docker Browser** 预构建包未经过 Apple 公证。首次安装或打开时若被系统拦截、或提示「已损坏」，通常与 **门禁（Gatekeeper）** 有关，可按下文处理。

---

## 1. 安装方式

- **DMG**：双击挂载后，将 **Docker Browser** 拖入 **应用程序（Applications）** 文件夹。
- **ZIP**：解压后，将 **Docker Browser.app** 移入 **/Applications** 或 **~/Applications**。

建议最终路径为：`/Applications/Docker Browser.app`。

---

## 2. 最简单的方法：Finder 右键打开（推荐）

1. 打开 **访达（Finder）**，进入 **应用程序** 文件夹，找到 **Docker Browser**。
2. **右键单击**（或按住 Control 再单击）应用图标，选择 **「打开」**。
3. 弹出安全警告后，再次点击 **「打开」**。

这样会永久添加 Gatekeeper 例外，以后双击正常启动。

---

## 3. 命令行方法：添加 Gatekeeper 例外

```bash
sudo spctl --add "/Applications/Docker Browser.app"
```

执行后重新打开应用即可。若安装在用户目录下，将路径改为实际位置：

```bash
sudo spctl --add ~/Applications/Docker\ Browser.app
```

> **为什么不用 `xattr -r -d com.apple.quarantine`？**
> 
> GitHub 发布的包在 Apple Silicon 上经过了代码签名（ARM64 系统要求）。macOS 会阻止对已签名 app bundle 内部文件的 xattr 修改，导致大量 `Operation not permitted` 报错。`spctl --add` 通过 Gatekeeper 策略数据库添加例外，不需要修改文件属性，因此不会遇到该问题。

---

## 4. 通过系统设置放行

1. 点击 **苹果菜单 → 系统设置 → 隐私与安全性**。
2. 在 **安全性** 区域查找是否出现「仍要打开」提示，按指引允许。

---

## 5. 最后手段：临时全局放宽门禁（慎用）

```bash
# 关闭全局门禁
sudo spctl --master-disable
# 打开应用后恢复默认
sudo spctl --master-enable
```

---

## 6. 命令对照

| 命令 | 作用范围 | 是否推荐 |
|------|----------|----------|
| Finder 右键 → 打开 | 单个应用 | ✅ 推荐首选 |
| `sudo spctl --add <.app 路径>` | 单个应用 | ✅ 推荐 |
| `sudo xattr -r -d com.apple.quarantine <.app 路径>` | 单个应用 | ⚠️ 已签名包会报 Operation not permitted，无效 |
| `sudo spctl --master-disable` | 整个系统 | ⚠️ 慎用，不建议长期开启 |

---

## 7. English summary

Prebuilt **Docker Browser** is **not Apple-notarized**. If macOS blocks launch or reports the app as **damaged**, use one of these methods:

**Easiest:** Right-click the app in Finder → **Open** → click **Open** in the warning dialog.

**Terminal:**
```bash
sudo spctl --add "/Applications/Docker Browser.app"
```

> Note: `sudo xattr -r -d com.apple.quarantine` does **not** work for this app because the bundle is code-signed (required for Apple Silicon). Use `spctl --add` instead — it adds a Gatekeeper exception without modifying file attributes.

---

**Author / maintainer:** Guo's · **Repository:** [github.com/unicorngithub/Docker-Browser](https://github.com/unicorngithub/Docker-Browser)
