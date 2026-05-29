# Vibe Tree v0.6.0 发布文案草案

目标版本：待确认，建议 `v0.6.0`。

这份文档分成两部分：

- App 内更新公告：来自 `updates/manifest.json`，给普通用户快速理解本次更新。
- GitHub Release Notes：正常 release 记录，给想了解完整版本变化的用户和开发者看。

## App 内更新公告

App 内公告不直接展示完整 GitHub Release body，而是读取 `updates/manifest.json` 里对应版本的结构化内容。

当前 `v0.6.0` 的 App 内展示内容大致如下：

```text
Vibe Tree v0.6.0

本次更新新增可选的多设备同养功能。升级后，原来的本机小树会继续保留；不登录 GitHub 也可以继续只在本机使用。

主要变化
- 登录同一个 GitHub 账号后，可以在多台设备共同养同一棵树。
- 开启同步后，会同步等级、累计 Token、成就和设备贡献。
- 其他设备的数据会按 Codex、OpenClaw、Claude Code 等真实来源合并展示。
- 排行榜改为 24h / 7 天 / 30 天 / 全部，更适合查看最近活跃度。

体验改进
- 设置页重新整理，同步、更新、路径等选项更容易找到。
- 加入排行榜确认、同步入口和升级提示等交互做了打磨。

隐私说明
- 同养小树是可选功能。
- Vibe Tree 不会上传提示词、回复内容、代码文件、本地路径或会话正文。
```

## GitHub Release Notes

下面是建议放进 GitHub Release body 的正式版本记录。

```md
# Vibe Tree v0.6.0

## Added

- Added optional shared-tree sync across devices. Users can sign in with the same GitHub account to grow one tree across Windows, Mac, and other devices.
- Added shared tree first-run choices: start locally on this device, or sign in to sync an existing tree.
- Added device contribution summaries for shared trees.
- Added rolling `24h` leaderboard range, alongside `7d`, `30d`, and `all`.
- Added hourly auto-sync options for the leaderboard and shared tree sync.

## Changed

- Reorganized Settings into clearer sections: Basics, Sync, Updates, and Agents.
- Clarified the difference between private shared-tree sync and public leaderboard publishing.
- Moved leaderboard join, leave, and refresh actions to the leaderboard page.
- Updated leaderboard confirmation to use the app UI and include the usage-preference sharing choice.
- Synced data is merged back into real sources such as Codex, OpenClaw, and Claude Code instead of appearing as a separate cloud source.
- Sources that only have data from another synced device now show clearer synced-record wording.
- Level-up notices now use the same toast system as achievements for more stable placement.

## Privacy

- Shared tree sync is optional.
- Shared tree sync sends only growth data needed for the tree, such as token counts, device id, coarse platform, achievement state, source category, and daily aggregate model totals.
- Leaderboard sync sends daily token totals, rolling 24h hourly aggregates, and local first-use date.
- Public usage preferences, when enabled, send only aggregate agent, model, time-period, and peak-token summaries.
- Vibe Tree does not upload prompts, replies, code file contents, local paths, session text, hostnames, or local usernames.

## Compatibility

- Existing local trees continue to work after upgrading.
- Users who do not enable shared-tree sync can keep using Vibe Tree locally as before.
- Existing leaderboard `today` requests remain supported as a compatibility alias for `24h`.
```

## 发布时需要确认

- `package.json` 版本号和 tag 是否已经更新到目标版本。
- `updates/manifest.json` 里的 `version` 和 `fullReleaseUrl` 是否对应真实 release tag。
- GitHub Release body 是否使用上面的正常 Release Notes，而不是 App 内公告。
- App 内「查看当前版本内容」是否能显示 manifest 中的短公告。
