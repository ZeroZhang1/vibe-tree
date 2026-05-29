# Vibe Tree 正式版发布清单草案

目标版本：待确认，建议作为 `v0.6.0` 级别发布。

当前候选分支：`codex/multi-device-tree-sync`

长期发布规则见 `docs/RELEASE_PROCESS.md`；本文件只记录本次 `v0.6.0` 候选版本的具体核对项。

## 发布定位

这次版本的用户价值是：

- 多台设备可以用同一个 GitHub 账号共同养同一棵树。
- 排行榜改成更符合直觉的 `24h / 7 天 / 30 天 / 全部`。
- 设置页、同步按钮、首次启动、升级弹窗和统计展示更清楚。
- 隐私边界保持清晰：不上传提示词、回复、代码文件、本地路径或会话正文。

这次不应该在用户公告里强调：

- 旧同步脏数据、D1 查询优化、delta API、缓存修复等内部实现细节。
- 具体数据库表名、迁移脚本名、Worker row read 指标。
- 任何容易让用户误以为上传了会话内容的字段细节。

## 代码冻结前

- [ ] 确认目标版本号，例如 `0.6.0`。
- [ ] 确认 `package.json` 版本号已更新。
- [ ] 确认 GitHub release/tag 命名，例如 `v0.6.0`。
- [ ] 确认当前分支已经合并或 rebase 到最新 `main`。
- [ ] 确认工作区干净：`git status --short`。
- [ ] 确认没有临时调试日志、测试入口、硬编码本地路径或本地账号信息。
- [ ] 确认更新公告使用用户可读内容，而不是完整开发 changelog。

## 必跑命令

在 Mac 和 Windows 都建议跑：

```bash
npm run typecheck
npm run build
npm run smoke:electron
npm run verify:cloud-sync
npm run verify:worker-api
git diff --check
```

如果 Windows 没有完全相同 shell 环境，至少要保证等价命令通过，并记录跳过项原因。

## 服务端发布

- [ ] 确认 Cloudflare Worker 使用目标分支对应代码。
- [ ] 确认 D1 迁移已跑完：
  - `db:migrate`
  - `db:migrate:privacy`
  - `db:migrate:sources`
  - `db:migrate:dedupe`
  - `db:migrate:devices`
  - `db:migrate:hourly`
  - `db:migrate:delta`
- [ ] 确认 `/health` 返回 200。
- [ ] 确认未登录请求 `/api/tree` 返回 401，而不是 404 或 500。
- [ ] 确认 `GET /api/leaderboard?range=24h` 正常返回。
- [ ] 确认 `GET /api/leaderboard?range=today` 作为老客户端兼容别名仍可用。
- [ ] 确认 `/api/tree/delta` 可用，且旧客户端仍可通过 `/api/tree` 全量兜底。
- [ ] 观察 Cloudflare 24h D1 rows read 是否回落到可接受范围。
- [ ] 如 D1 指标仍偏高，确认不会影响线上稳定性后再发版。

## 隐私与数据边界

- [ ] 同养小树同步 payload 只包含 token 数字、设备 id、设备平台、成就状态、来源分类和聚合模型统计。
- [ ] 排行榜默认只同步每日 Token 总量、24h 小时级汇总和本地首次使用日期。
- [ ] 公开使用偏好只上传聚合后的 Agent、模型、时段和峰值 Token。
- [ ] 明确确认不会上传：
  - prompt
  - reply
  - code file content
  - local path
  - session text
  - raw note
  - hostname / username
- [ ] 使用 `verify:cloud-sync` 和 `verify:worker-api` 覆盖隐私白名单。
- [ ] 真实账号同步后抽查 Worker/D1 payload，没有敏感字段。

## Mac 回归

- [ ] 旧数据升级后总 XP 不翻倍。
- [ ] 首页来源仍显示 Codex / OpenClaw / Claude Code 等真实来源，不出现 Cloud Tree / cloud-sync。
- [ ] 今日 / 总计切换正常。
- [ ] 最近 7 天图表按来源和 token 类型展示正常。
- [ ] 模型占比没有大面积 `unknown`，缺模型时显示用户可理解的兜底文案。
- [ ] 设置页四个分类正常：基础 / 同步 / 更新 / 路径。
- [ ] 同步页里的「同步小树」按钮不需要滚到底才能看到。
- [ ] 「每小时自动同步排行榜」和「每小时自动同步小树」开关状态可保存。
- [ ] 设备列表只显示有效设备，不显示一堆 0 token 旧设备。
- [ ] 首次启动选择「新养一棵树」可直接进入主页。
- [ ] 首次启动选择「同步云端小树」后取消登录，两个选项恢复可点。
- [ ] level up 弹窗不再被桌宠缩放裁切，能和成就弹窗排队展示。
- [ ] 三套主题下设置页没有明显遮挡、溢出或风格不一致。

## Windows 回归

- [ ] 拉到目标 commit 后启动真实 Windows 数据目录，不清空用户数据。
- [ ] Windows 原有 OpenClaw / Claude Code / Codex 来源不丢失。
- [ ] 同步小树后 XP 不翻倍，cache read 不重复计数。
- [ ] Windows 产生少量新 token 后同步，Mac 再同步可以看到增长。
- [ ] Mac 产生少量新 token 后同步，Windows 再同步可以看到增长。
- [ ] Windows 设置页设备列表显示 Windows + Mac，贡献量合理。
- [ ] Windows 排行榜 `24h / 7 天 / 30 天 / 全部` 都能正常刷新。
- [ ] Windows 首启取消登录流程不再卡死。
- [ ] Windows 打开管理窗口、桌宠拖动、设置按钮、分享按钮交互正常。

## 跨设备验收路径

建议最终验收按这个顺序跑一次：

1. Windows 同步小树。
2. Mac 同步小树。
3. Mac 产生一点 token。
4. Mac 同步小树。
5. Windows 同步小树。
6. Windows 产生一点 token。
7. Windows 同步小树。
8. Mac 同步小树。

通过标准：

- 两边总 XP 接近一致。
- 两边等级一致或只差正在产生中的本地 token。
- 来源分类不丢。
- 模型占比没有明显回退。
- 设备贡献能解释本机和其他设备占比。

## 排行榜验收

- [ ] 未加入排行榜时，能查看榜单。
- [ ] 加入排行榜时显示应用内确认弹窗，不用系统弹窗。
- [ ] 加入时可选择是否公开使用偏好。
- [ ] 已加入后「同步并刷新」会上传自己的排行榜数据并刷新榜单。
- [ ] 退出排行榜只删除远端排行榜数据，不删除同养小树云档。
- [ ] `24h` 排行榜使用滚动 24 小时，不是自然日。
- [ ] 7 天 / 30 天 / 全部仍使用日汇总逻辑。
- [ ] 老版本用户使用 `today` range 不会被破坏。

## 更新与打包

- [ ] 确认最终版本号和 tag。
- [ ] 确认 `updates/manifest.json` 里的版本号、`fullReleaseUrl` 和目标 release tag 一致。
- [ ] 确认 App 内「查看当前版本内容」展示的是 `updates/manifest.json` 里的短公告。
- [ ] 确认 GitHub release body 使用正常 Release Notes，不把 App 内短公告当作完整 release。
- [ ] 打包后在 Mac 上安装覆盖旧版验证。
- [ ] 打包后在 Windows 上安装覆盖旧版验证。
- [ ] 确认「打开发布页」能打开正确 GitHub Releases 页面。

## 可接受的已知尾巴

以下问题如果已经确认不影响用户主链路，可以不阻塞发版，但需要记录：

- 云端可能残留少量旧的 0 token 设备或 orphan 聚合统计；客户端已过滤，不影响普通用户展示。
- D1 rows read 需要继续观察一段时间，确认 delta sync 和缓存上线后趋势正常。
- App 内更新公告已走 `updates/manifest.json`，但发布时仍要确认 GitHub raw 文件已随 main 更新。

## 发版后观察

- [ ] 观察 Worker 错误率、D1 rows read、rows written。
- [ ] 观察排行榜刷新是否出现 500 / 503。
- [ ] 观察同步小树是否出现重复计数、来源丢失、模型占比大面积未归类。
- [ ] 收集 Windows / Mac 覆盖安装后的首小时反馈。
- [ ] 如果发现服务端指标异常，优先考虑暂停推荐更新，而不是要求用户清空本地数据。
