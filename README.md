# Vibe Bonsai

简体中文 | [English](README.en.md)

桌面常驻的 Token 天气树。它把本地 coding agent 的 token 消耗变成一棵可以养成的小树：

- 累计 XP 决定等级和成长阶段。
- 最近 XP/min 决定桌面天气。
- 小树以透明悬浮窗常驻桌面，管理窗口负责数据、来源和调试。

## 运行

macOS / Linux / Windows:

```bash
npm install
npm start
```

开发模式：

```bash
npm run dev
```

验证：

```bash
npm run typecheck
npm run build
```

## 当前 v1 范围

- Electron 桌面宠物窗口：透明、置顶、可拖动、可锁定。
- Electron 管理窗口：显示等级、天气、活跃会话、来源统计和最近 7 天。
- 设备级设置：小树大小、锁定/置顶、开机启动、静默启动和来源路径覆盖。
- XP 规则：
  - 真实 agent 用量：`XP = inputTokens + outputTokens`
  - `cacheReadTokens` / `cacheWriteTokens` 只记录来源明细，暂不计入 XP。
- 自动来源：
  - Codex session 文件。
  - Claude Code session 文件。
  - OpenClaw session 文件。
  - OpenCode message 文件。
- 手动喂养：用于测试成长和天气反馈。

## Source Watchers

默认使用当前系统用户目录：

Codex Desktop:

```text
macOS:   ~/.codex/sessions/**/*.jsonl
Windows: %USERPROFILE%\.codex\sessions\**\*.jsonl
```

Claude Code:

```text
macOS:   ~/.claude/projects/**/*.jsonl
Windows: %USERPROFILE%\.claude\projects\**\*.jsonl
```

OpenClaw:

```text
macOS:   ~/.openclaw/agents/**/sessions/*.jsonl
Windows: %USERPROFILE%\.openclaw\agents\**\sessions\*.jsonl
```

OpenCode:

```text
macOS:   ~/.local/share/opencode/storage/message/**/*.json
Windows: %LOCALAPPDATA%\opencode\storage\message\**\*.json
```

默认从应用安装当天开始统计，安装日前的历史不会计入小树成长。

可选强制导入当天历史，macOS / Linux:

```bash
VIBE_CODEX_IMPORT_HISTORY=today \
VIBE_CLAUDE_IMPORT_HISTORY=today \
VIBE_OPENCLAW_IMPORT_HISTORY=today \
VIBE_OPENCODE_IMPORT_HISTORY=today \
npm start
```

Windows PowerShell:

```powershell
$env:VIBE_CODEX_IMPORT_HISTORY="today"
$env:VIBE_CLAUDE_IMPORT_HISTORY="today"
$env:VIBE_OPENCLAW_IMPORT_HISTORY="today"
$env:VIBE_OPENCODE_IMPORT_HISTORY="today"
npm start
```

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

旧 PNG、image2 候选图、实验预览页和视觉 checkpoint 不属于当前产品运行链路。

## Game Balance

成长、天气和活跃窗口统一由这个文件配置：

```text
public/assets/trees/vibe-bonsai/config/game-balance.json
```

当前包含：

- XP 等级曲线：`levelBase`、`levelExponent`、`maxLevel`
- 天气阈值：按 `minXpPerMinute`
- 阶段阈值：按 `minLevel`
- 活跃窗口：active window / peak window

## Persistence

Electron 数据目录里会保存：

- `usage-events.jsonl`：append-only usage 事件库
- `usage-meta.json`：安装日期等 usage 元信息
- `device-settings.json`：本机设备级设置
- `codex-session-watcher.json`：Codex watcher offset
- `claude-session-watcher.json`：Claude watcher offset
- `openclaw-session-watcher.json`：OpenClaw watcher offset
- `opencode-session-watcher.json`：OpenCode watcher state

## 产品方向

Vibe Bonsai 不是单纯 token dashboard，而是把 vibe coding 的消耗、节奏和活跃度变成桌面宠物反馈。第一版先把本地 Codex / Claude Code / OpenClaw / OpenCode 的自动读取做顺，再继续打磨桌宠表现、天气反馈和养成数值。
