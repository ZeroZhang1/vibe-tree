# Vibe Tree 社交好友与群组开发方案

## 目标

这条线的主目标不是企业报表，而是提升 Vibe Tree 的可玩性：让用户像游戏里加好友、进公会、看好友榜和群组贡献一样，围绕自己的小树产生轻量社交关系。

Jacky 的公司 token 消耗统计需求是这个系统自然覆盖的场景：公司可以建一个群组，成员加入后看群组总贡献、成员榜和模型分布。但产品气质仍然应该像游戏社交，而不是冷冰冰的企业用量后台。

## 成熟产品参考

- Steam Community Groups：用户创建兴趣/游戏群组，群组拥有 owner/admin 工具，可以控制成员和权限。参考：<https://help.steampowered.com/en/faqs/view/4030-bc19-140f-45da>
- PlayFab Community：把 friends、groups、leaderboards 作为游戏社区基础设施，并支持好友限定排行榜。参考：<https://learn.microsoft.com/en-ca/gaming/playfab/community/> 和 <https://learn.microsoft.com/mt-mt/gaming/playfab/features/social/friends/friends-leaderboards>
- Clash of Clans / Brawl Stars：公会/俱乐部有固定角色层级、成员贡献和管理权限。参考：<https://support.supercell.com/clash-of-clans/en/articles/clan-roles-3.html> 和 <https://support.supercell.com/brawl-stars/en/articles/clubs-and-club-roles-3.html>
- Discord：服务器/群组通过邀请链接、角色和权限来降低加入成本，同时限制管理风险。参考：<https://support.discord.com/hc/en-us/articles/206029707-Server-Roles> 和 <https://docs.discord.com/developers/resources/invite>

## 产品形态

Vibe Tree 里的社交系统可以按游戏语义命名和组织：

- 好友：看彼此的小树资料卡、今日成长、成就和好友榜。
- 群组：类似公会/战队/俱乐部，是长期关系，不只是临时统计口径。
- 群组榜：24h、7d、30d、全部范围内的成员贡献榜。
- 群组贡献：群组总 token、成员贡献、常用模型、活跃趋势。
- 角色：leader、officer、member。第一版不做复杂自定义权限。
- 邀请：用邀请码/邀请链接加入群组，后续再做申请审核。
- 资料卡：展示头像、名字、小树等级、成就、好友/群组关系。

## MVP 范围

第一阶段只做社交地基，不急着做完整前端：

- Worker 新增好友和群组基础表。
- Worker 新增群组创建、群组列表、群组详情、邀请码、加入群组、群组榜单 API。
- 群组榜单先复用现有 `daily_usage` / `hourly_usage` 聚合数据。
- 群组成员默认只在群组内展示汇总 token，不上传提示词、回复、代码、本地路径或会话正文。
- 保留全球排行榜，不把群组功能塞进全球榜。

暂不做：

- 聊天。
- 动态 feed。
- 复杂角色权限编辑器。
- 好友私信。
- 组织 SSO。
- 按公司域名自动入组。

## 隐私边界

继续沿用现有边界：

- 不上传提示词、回复、代码文件、本地路径、会话正文。
- 群组统计只使用汇总 token、小时/天聚合、模型聚合和公开资料。
- 个人身份、设备同步身份、群组成员身份分开。
- 加入群组不等于加入全球排行榜；后续应该把“上传私有社交统计”和“公开全球榜”拆得更清楚。

## 后端模型

新增表建议：

- `social_friendships`
  - `user_low`
  - `user_high`
  - `requester_user_id`
  - `status`: `pending` / `accepted` / `blocked`
  - `created_at`
  - `updated_at`

- `social_groups`
  - `group_id`
  - `name`
  - `description`
  - `icon_emoji`
  - `visibility`: `invite` / `closed`
  - `owner_user_id`
  - `created_at`
  - `updated_at`

- `social_group_members`
  - `group_id`
  - `user_id`
  - `role`: `leader` / `officer` / `member`
  - `share_usage`
  - `joined_at`
  - `updated_at`

- `social_group_invites`
  - `invite_code_hash`
  - `group_id`
  - `created_by_user_id`
  - `role`
  - `max_uses`
  - `uses`
  - `expires_at`
  - `revoked_at`
  - `created_at`
  - `updated_at`

## API 设计

第一阶段 API：

- `GET /api/social/groups`
  - 返回当前用户加入的群组。
- `POST /api/social/groups`
  - 创建群组，创建者自动成为 `leader`。
- `GET /api/social/groups/:groupId`
  - 返回群组详情、成员、当前用户角色。
- `POST /api/social/groups/:groupId/invites`
  - leader/officer 创建邀请。
- `POST /api/social/invites/:code/accept`
  - 当前用户接受邀请并加入群组。
- `GET /api/social/groups/:groupId/leaderboard?range=24h|7d|30d|all`
  - 返回群组内部成员榜。

好友 API 可以在第二阶段加：

- `GET /api/social/friends`
- `POST /api/social/friend-requests`
- `POST /api/social/friend-requests/:id/accept`
- `DELETE /api/social/friends/:userId`

## UI 落点

第一版 UI 建议在管理窗口新增一个主 tab：

- `社交`

里面分两块：

- 好友：好友列表、添加好友、好友榜。
- 群组：我的群组、创建群组、加入群组、群组榜。

排行榜页后续可以加 scope 切换：

- 全球
- 好友
- 群组

但不要第一刀就把排行榜页做复杂。先让 `社交` tab 成为入口，排行榜页后续再融合。

## 实施顺序

1. Worker schema、迁移和 API 骨架。
2. Worker 验证脚本覆盖创建群组、邀请加入、群组榜。
3. Electron service / preload 类型接入。
4. 管理窗口新增 `社交` tab，先展示群组列表和群组榜。
5. 加好友资料卡和好友榜。
6. 再考虑群组成就、群组等级、赛季榜、群组动态。
