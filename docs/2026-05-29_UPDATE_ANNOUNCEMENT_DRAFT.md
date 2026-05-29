# Vibe Tree 更新公告草案

目标版本：待确认，建议 `v0.6.0`

这份文案面向从上一个正式包升级的用户，可以作为 GitHub Release 正文或应用内「查看当前版本内容」的基础。正式发布前需要把版本号、下载链接和日期补齐。

## 中文短版

### Vibe Tree v0.6.0

这次更新新增了可选的多设备同养功能。

升级后，你原来的本机小树会继续保留。需要跨设备使用时，可以在 Windows、Mac 等设备上登录同一个 GitHub 账号，把各设备产生的 Token、等级和成就合并到同一棵小树里；不登录也可以继续只在本机使用。

主要变化：

- 新增「同养一棵树」：登录后可跨设备同步等级、累计 Token、成就和设备贡献。
- 本机使用方式不变：不开启同步时，小树仍然只统计本机之后产生的 Token。
- 开启同步后，其他设备的数据会按 Codex、OpenClaw、Claude Code 等真实来源合并展示。
- 排行榜改为 `24h / 7 天 / 30 天 / 全部`，24h 更适合看最近活跃度。
- 设置页重新整理，同步、更新、路径等选项更容易找到。
- 加入排行榜确认、同步入口和升级提示等交互做了打磨。

隐私说明：

同养小树是可选功能。开启后，它只同步养成需要的聚合数据，例如 Token 数字、设备 id、设备平台、成就状态和按天汇总的模型 Token。排行榜默认只同步每日 Token 总量、24h 小时级 Token 汇总和本地首次使用日期。

Vibe Tree 不会上传你的提示词、回复内容、代码文件、本地路径或会话正文。

## 中文完整版

### Vibe Tree v0.6.0

这一版的重点是：Vibe Tree 新增了可选的多设备同养能力。

升级后，你原来的本机小树会继续保留；如果不登录 GitHub，也可以像之前一样只在本机使用。

如果你同时在 Windows 和 Mac 上使用本地 coding agent，现在可以选择登录同一个 GitHub 账号，把多台设备的成长合并到同一棵小树里。等级、累计 XP、成就状态和设备贡献都会一起延续。新设备第一次打开时，可以选择从本机开始，也可以同步已有的小树。

#### 新功能

- 多设备同养一棵树：登录后可同步 Token 成长、等级、成就和设备贡献。
- 设备贡献展示：开启同步后，可以看到本机和其他设备分别贡献了多少 Token。
- 24h 排行榜：排行榜新增滚动 24 小时视角，比自然日更适合比较最近活跃度。
- 每小时自动同步：排行榜和同养小树可以在开启后按小时自动同步。

#### 体验改进

- 首页数据来源更自然：开启多设备同步后，其他设备的数据会合并到 Codex、OpenClaw、Claude Code 等真实来源里。
- 设置页重新分组：基础、同步、更新、路径分开展示，按钮语义更清楚。
- 新设备启动选择更清楚：可以本机新开始，也可以登录后同步已有小树。
- 加入排行榜确认改成应用内弹窗，并可同时选择是否公开使用偏好。
- 升级提示复用应用内弹窗样式，避免在小尺寸桌宠上显示不全。
- 如果某个来源的数据来自其他设备，首页会用同步记录说明，避免误以为本机需要安装对应工具。

#### 统计展示

- 开启同养小树后，其他设备的 Token 会按原始来源归类，例如 Codex、OpenClaw、Claude Code。
- 同步后的数据会参与总量、今日成长、最近 7 天和来源统计，不需要单独理解一个“云端来源”。
- 模型占比使用聚合统计展示；如果某些历史数据确实缺少模型信息，会显示为更清楚的未归类文案。
- 排行榜和同养小树保持两套清晰语义：排行榜负责公开展示，同养小树负责私有成长档案同步。

#### 隐私边界

同养小树是可选功能。开启后，它和排行榜都只同步养成与排行需要的聚合信息。

会同步的内容包括：

- Token 数字
- 设备 id 和粗粒度平台，例如 Windows / Mac
- 成就状态
- 来源分类，例如 Codex / OpenClaw / Claude Code
- 按天汇总的模型 Token
- 排行榜所需的每日 Token 和 24h 小时级汇总

不会同步的内容包括：

- 提示词
- 回复内容
- 代码文件内容
- 本地路径
- 会话正文
- 本机用户名或主机名

## English Draft

### Vibe Tree v0.6.0

This release adds optional shared-tree sync across devices.

Your existing local tree stays local after upgrading. If you want to use Vibe Tree on multiple devices, you can sign in with the same GitHub account on Windows, Mac, and other devices, then merge Token growth, levels, achievements, and device contribution into one shared tree.

Highlights:

- Added optional shared tree sync across devices.
- Added device contribution summaries after sync is enabled.
- Changed the leaderboard to `24h / 7d / 30d / all`.
- Reworked Settings into clearer sections.
- Improved leaderboard confirmation, sync entry points, and level-up notifications.
- When sync is enabled, remote device data is merged back into real sources such as Codex, OpenClaw, and Claude Code.

Privacy:

Shared tree sync is optional. When enabled, Vibe Tree only syncs aggregate growth data needed for the tree and leaderboard, such as token counts, device id, coarse platform, achievement state, source category, and daily aggregate model totals.

It does not upload prompts, replies, code files, local paths, or session text.
