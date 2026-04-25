# Windows 打包漏依赖经验总结

## 核心结论

- 这类问题本质是“**打包时依赖收集不完整**”，不是单个模块偶发缺失。
- 在 `electron-builder + pnpm` 组合下，依赖布局对收集结果影响很大。
- 手动补一个缺一个是短期止血，不是长期方案。

## 稳定配置基线

- `.npmrc` 使用：

```ini
shamefully-hoist=true
```

- 保持主进程运行时依赖可被 `electron-builder` 稳定发现。
- 避免顶层依赖干扰底层包解析（例如顶层 `uuid` 版本与 `dockerode` 依赖链不兼容）。

## 发布前必须做的校验

- 保留并执行 `scripts/verify-packaged-modules.mjs`。
- `verify:pack` 必须挂在 `dist` / `dist:dir` 后作为强闸门。
- 校验失败时直接阻断发布，不要带病产出安装包。

## 维护规范

- 升级 `pnpm`、`electron-builder` 或关键运行时依赖后，必须重新跑完整打包与校验。
- 若出现 `Cannot find module ...`，优先相信打包校验结果，不做盲目“连环补依赖”。
- 统一团队打包环境（同一 `.npmrc`、同一锁文件、同一打包命令），减少“我这能打、你那不能”的漂移。

## 一句话原则

**依赖布局先稳定，打包校验要强制，失败就阻断发布。**
