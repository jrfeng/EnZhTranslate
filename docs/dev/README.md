# 开发者文档

面向维护本项目的开发者，记录「为什么这么写」以及可调节的内部开关。

## 目录

| 文档 | 内容 |
|---|---|
| [防白屏机制（boot guard）](./boot-guard.md) | 窗口隐藏 / 主题先行 / 内容隐藏 / 兜底延时四件套的作用、总开关、开与关的行为对比 |
| [窗口宽度调试角标（size badge）](./size-badge.md) | 左下角 `宽 × 高` 角标的启用条件、快捷键、样式与常见问题 |
| [Android 支持方案](./android-plan.md) | 移植 Android 的范围、决策、分阶段实施清单 |

## 约定

- 涉及「内部开关」的改动，在文档里写清楚三个要素：**默认值**、**怎么打开/关闭**、**关闭后由谁兜底**
- 开关变量统一用 `FISH_*` 环境变量（构建期）或 `fish-app.*` 开头的 localStorage 键（运行时），与现有 `FISH_DEBUG`、`fish-app.theme` 保持一致
- 影响多个层的开关必须**一处注入、多处读取**（例如防白屏开关注入到 `boot-head.js` 的 `data-boot-guard`，CSS 与 `boot-body.js` 都读它）
- 代码里给开关写注释，注释中引用本文档路径

## 现有开关一览

| 开关 | 作用域 | 默认 | 说明 |
|---|---|---|---|
| `FISH_DEBUG=1` | 构建期 | 关闭 | 打包宽度调试角标（release 包整段剔除） |
| `FISH_BOOT_GUARD=1` | 构建期 | 关闭 | 防白屏四件套：窗口隐藏 / 主题先行 / 内容隐藏 / 兜底延时 |
| `__APP_VERSION__` | 构建期 | `package.json` 的 version | 标题栏版本号 |
| `fish-app.theme` | 运行时（localStorage） | 跟随系统 | 主题选择，防白屏开关关闭时由 `app.js` 启动后应用 |
| `fish-app.debug-size` | 运行时（localStorage） | 无记录时显示 | 宽度角标显隐，`'1'` 显示 / `'0'` 隐藏 |
| `Ctrl+Shift+D` | 运行时 | — | debug 构建里切换宽度角标显示 |
