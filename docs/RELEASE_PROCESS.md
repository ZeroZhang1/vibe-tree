# Vibe Tree 发布规则

这份文档是长期发布约定，适用于后续所有正式版本。单次发版的具体核对项可以另写日期化 checklist，例如 `docs/2026-05-29_RELEASE_CHECKLIST.md`。

## 核心原则

- GitHub Release 是正常版本记录，不是 App 内更新公告的加长版。
- App 内更新公告走 `updates/manifest.json`，只展示用户最需要知道的短摘要。
- 正式包面向的是上一个正式版本用户，不假设用户知道开发分支、测试脏数据或内部排障背景。
- 隐私边界必须写清楚，也必须和真实 payload 一致。
- 不能为了发版让用户清空本地数据；覆盖升级必须是默认路径。

## 版本号

- 使用语义化版本：`major.minor.patch`。
- 新增用户可见能力时，优先升 minor，例如 `0.5.5 -> 0.6.0`。
- 只修 bug 或小 UI 问题时，升 patch。
- tag 使用 `vX.Y.Z`，`package.json` 使用 `X.Y.Z`。
- `updates/manifest.json` 里的 `version` 必须和 `package.json`、tag 对齐。

## App 内更新公告

App 内更新公告由 `updates/manifest.json` 维护。

每个版本至少包含：

- `version`
- `fullReleaseUrl`
- `title`
- `summary`
- `highlights`
- `privacy`

推荐包含：

- `fixes`：用户能理解的体验改进，不写开发期内部 bug。
- `upgradeNotes`：需要用户注意的升级事项。

写作规则：

- 面向普通用户，短、清楚、少术语。
- 从上一个正式包用户的现实出发。
- 对可选功能明确写“可选”。
- 不写开发期问题，例如“修复同步后 XP 膨胀”、“cloud-sync 来源丢失”、“D1 rows read 优化”。
- 不写数据库表名、迁移脚本、Worker 内部实现。
- 不夸大隐私能力；只写已经由代码和验证覆盖的事实。

## GitHub Release Notes

GitHub Release body 使用正常 release notes。

推荐结构：

```md
# Vibe Tree vX.Y.Z

## Added

## Changed

## Fixed

## Privacy

## Compatibility
```

写作规则：

- 可以比 App 内公告更完整，但仍然不要写内部排障流水账。
- `Added / Changed / Fixed` 面向实际发布版本之间的变化。
- `Fixed` 只写上一个正式版本用户可能遇到的问题，或本次正式功能上线前必须说明的稳定性修复。
- 隐私相关变化必须单列 `Privacy`。
- 兼容性、旧版本行为、升级注意事项放在 `Compatibility`。

## 服务端与数据迁移

如果版本涉及 Worker 或 D1：

- 先合并代码，再跑远端迁移，再部署 Worker。
- README 的部署步骤必须包含新增迁移。
- 迁移脚本必须可重复执行或明确说明只运行一次。
- 客户端必须兼容“服务端已升级但旧客户端仍在使用”的情况。
- 服务端必须兼容“客户端已升级但 manifest、release 或缓存短暂不可用”的情况。

发布前至少确认：

- `/health` 返回 200。
- 未登录访问受保护 API 返回 401，而不是 404 或 500。
- 旧客户端仍使用的 route 没被破坏。
- 新 route 有本地或脚本验证覆盖。

## 验证

每次正式发版前至少跑：

```bash
npm run typecheck
npm run build
npm run smoke:electron
npm run verify:cloud-sync
npm run verify:worker-api
git diff --check
```

涉及跨平台行为时，还需要 Windows 和 Mac 真机回归。

涉及更新公告时，还要确认：

- `updates/manifest.json` 是合法 JSON。
- App 内「查看当前版本内容」显示 manifest 短公告。
- 「打开发布页」打开 GitHub Release。
- GitHub Release body 是正常 release notes，不是 App 内短公告。

## 隐私发布规则

任何同步、排行榜、统计、云端能力都必须遵守：

- 不上传 prompt。
- 不上传 reply。
- 不上传代码文件内容。
- 不上传本地路径。
- 不上传会话正文。
- 不上传本机用户名或 hostname。
- 只上传功能需要的 token 数字、来源分类、设备 id、粗粒度平台、成就状态和聚合统计。

如果新增字段，需要同时更新：

- 代码里的 payload 白名单或清洗逻辑。
- `verify:cloud-sync` 或 `verify:worker-api`。
- App 内隐私说明。
- GitHub Release 的 `Privacy` 部分。

## 发布顺序

推荐顺序：

1. 更新代码和文档。
2. 更新版本号。
3. 更新 `updates/manifest.json`。
4. 跑本地验证。
5. 部署服务端和 D1 迁移，如本次需要。
6. Mac 覆盖安装验证。
7. Windows 覆盖安装验证。
8. 创建 tag 和 GitHub Release。
9. 确认 App 内更新检查能看到新版本和 manifest 短公告。
10. 发版后观察 Worker、D1、排行榜和同步错误率。

## 回滚与暂停

如果发版后发现严重问题：

- 优先暂停推荐更新或撤下 release asset。
- 不要求用户清空本地数据作为默认修复方案。
- 如涉及服务端错误，优先回滚 Worker 或修复兼容 route。
- 如涉及数据污染，先确认可否通过 authoritative 远端数据或本地修复脚本恢复。
