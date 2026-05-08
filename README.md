# Vibe Bonsai

桌面常驻的 Token 天气树。它把本地 coding agent 的 token 消耗变成一棵可以养成的小树：

- 累计 XP 决定等级和成长阶段。
- 最近 XP/min 决定桌面天气。
- 小树以透明悬浮窗常驻桌面，管理窗口负责数据、来源和调试。

## 运行

```powershell
npm install
npm start
```

开发模式：

```powershell
npm run dev
```

验证：

```powershell
npm run typecheck
npm run build
```

## 当前 v1 范围

- Electron 桌面宠物窗口：透明、置顶、可拖动、可锁定。
- Electron 管理窗口：显示等级、天气、活跃会话、来源统计和最近 7 天。
- XP 规则：
  - 真实 agent 用量：`XP = inputTokens + outputTokens * 2`
  - `cacheReadTokens` / `cacheWriteTokens` 只记录来源明细，暂不计入 XP。
- 自动来源：
  - Codex session 文件。
  - Claude Code session 文件。
  - OpenClaw session 文件。
- 手动喂养：用于测试成长和天气反馈。
- 本地 `/v1` 网关原型：预留给 OpenAI-compatible API 代理接入。

## 资产

运行时只保留当前确定的纯 SVG 像素树资产：

```text
public/assets/trees/vibe-bonsai/
  config/
    game-balance.json
    pure-svg-manifest.json
  pure-svg/
    01-sprout-layered-idle.svg
    02-seedling-layered-idle.svg
    03-young-layered-idle.svg
    04-medium-layered-idle.svg
    05-lush-layered-idle.svg
    06-full-layered-idle.svg
```

旧 PNG、image2 候选图、实验预览页和视觉 checkpoint 不属于当前产品运行链路，已经从仓库主线移除。

## 主要目录

```text
src/electron/              Electron 主进程、窗口、session 监控、本地网关
src/renderer/              小树和管理面板 UI
src/shared/                共享类型
public/assets/trees/       当前运行时树资产和数值配置
scripts/                   开发和构建辅助脚本
```

## 产品方向

Vibe Bonsai 不是单纯 token dashboard，而是把 vibe coding 的消耗和活跃度变成桌面宠物反馈：

- 长期 token 消耗推动小树成长。
- 短期 token 速率改变天气强度。
- 不同 agent 的消耗会被拆分成来源，后续可以扩展成更完整的养成记录。
