# Vibe Tree 更新公告草案

目标版本：待确认，建议 `v0.6.0`

这份文案面向用户，可以作为 GitHub Release 正文或应用内「查看当前版本内容」的基础。正式发布前需要把版本号、下载链接和日期补齐。

## 中文短版

### Vibe Tree v0.6.0

这次更新让 Vibe Tree 可以在多台设备上共同养同一棵树。

你现在可以在 Windows、Mac 等设备上登录同一个 GitHub 账号，把各设备产生的 Token、等级和成就合并到同一棵小树里。新设备首次打开时，可以选择从本机新开始，也可以同步云端小树继续养。

主要变化：

- 新增「同养一棵树」：跨设备同步等级、累计 Token、成就和设备贡献。
- 首页统计更清楚：同步回来的数据会合并进 Codex、OpenClaw、Claude Code 等真实来源，不再单独显示成云端来源。
- 排行榜改为 `24h / 7 天 / 30 天 / 全部`，24h 更适合看最近活跃度。
- 设置页重新整理，同步、更新、路径等选项更容易找到。
- 首次启动、取消登录、加入排行榜确认、升级提示等交互做了打磨。
- 多设备同步的统计口径已整理好：来源、模型占比、设备贡献和排行榜会各自显示在更合适的位置。

隐私说明：

同养小树只同步养成需要的聚合数据，例如 Token 数字、设备 id、设备平台、成就状态和按天汇总的模型 Token。排行榜默认只同步每日 Token 总量、24h 小时级 Token 汇总和本地首次使用日期。

Vibe Tree 不会上传你的提示词、回复内容、代码文件、本地路径或会话正文。

## 中文完整版

### Vibe Tree v0.6.0

这一版的重点是：多台设备可以共同养同一棵 Token 天气树。

如果你同时在 Windows 和 Mac 上使用本地 coding agent，现在可以登录同一个 GitHub 账号，把两边的成长合并到同一棵小树里。等级、累计 XP、成就状态和设备贡献都会一起延续。第一次在新设备打开时，你可以选择「本机新开始」，也可以选择「同步云端小树」继续已有进度。

#### 新功能

- 多设备同养一棵树：支持同步 Token 成长、等级、成就和设备贡献。
- 设备贡献展示：可以看到本机和其他设备分别贡献了多少 Token。
- 24h 排行榜：排行榜新增滚动 24 小时视角，比自然日更适合比较最近活跃度。
- 每小时自动同步：排行榜和同养小树都可以按小时自动同步。

#### 体验改进

- 首页数据来源更自然：云端同步回来的数据会直接合并到 Codex、OpenClaw、Claude Code 等真实来源里。
- 设置页重新分组：基础、同步、更新、路径分开展示，按钮语义更清楚。
- 首次启动流程优化：取消登录后可以重新选择，不会卡在同步状态。
- 加入排行榜确认改成应用内弹窗，并可同时选择是否公开使用偏好。
- 升级提示复用应用内弹窗样式，避免在小尺寸桌宠上显示不全。
- 没有本机安装的来源，如果数据来自其他设备，会用更清楚的同步记录说明。

#### 统计展示

- 多设备同步后的 Token 会按原始来源归类，例如 Codex、OpenClaw、Claude Code。
- 同步回来的远端数据会参与总量、今日成长、最近 7 天和来源统计，不需要单独理解一个“云端来源”。
- 模型占比使用聚合统计展示；如果确实缺少模型信息，会显示为更清楚的未归类文案。
- 排行榜和同养小树保持两套清晰语义：排行榜负责公开展示，同养小树负责私有成长档案同步。

#### 隐私边界

同养小树和排行榜都只同步养成与排行需要的聚合信息。

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

This release lets multiple devices grow the same Vibe Tree.

You can sign in with the same GitHub account on Windows, Mac, and other devices, then merge Token growth, levels, achievements, and device contribution into one shared tree. On first launch, a new device can either start fresh or sync the existing cloud tree.

Highlights:

- Added shared tree sync across devices.
- Added device contribution summaries.
- Changed the leaderboard to `24h / 7d / 30d / all`.
- Reworked Settings into clearer sections.
- Improved first-run sync cancellation, leaderboard confirmation, and level-up notifications.
- Organized synced stats so sources, model share, device contribution, and leaderboard data appear in the right places.

Privacy:

Vibe Tree only syncs aggregate growth data needed for the tree and leaderboard, such as token counts, device id, coarse platform, achievement state, source category, and daily aggregate model totals.

It does not upload prompts, replies, code files, local paths, or session text.
