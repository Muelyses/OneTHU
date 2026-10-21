# 组织主页 + 分享口令改名/限定邮箱（2026-10-19 晚）

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


> 用户口径：
> - 「口令应该可以改名，可以设定某个用户邮箱才有权限接收」；
> - 「组织不能只是一张卡片，而是一个完整的页面，可以创建或者关联 gitlab 仓库、
>   共享资料库（不只是文件夹！），成员也都是具体邮箱关联的而不只是一个名字。
>   总之，是一个可以真正处理的组织架构」。

## 一、分享口令（暂存箱）

`state/vaultShare.ts` 的 payload 增加两个随码携带的字段：

| 字段 | 含义 |
| --- | --- |
| `label` | 口令名（发送方命名，接收方可见） |
| `allowEmail` | 限定接收邮箱；设置后只有该清华云盘账号能打开 |

- 台账 `state/vaultShareLog.ts` 每条记录增加 `label` / `allowEmail`；
  「已发出的口令」面板（`components/vault/IssuedSharesCard.tsx`）新增
  **改名**、**限定邮箱** 两个动作。
- 改名/限定不换码：`updateShareMeta(code, patch)` 解出云清单 → 改字段 →
  `VaultCloudAdapter.update(ref, payload)` 把 manifest 就地写回原分享目录
  （整份读回来再写，避免丢 items）。旧版「内容写在码里」的本地长口令如实提示重新生成。
- 接收端在 `importShareCodeAsCurrent` 两处强制校验：① 短码解码后；
  ② 读到云清单后（云清单是权威，发送方后来改的限制也拦得住）。
  身份 = 当前连接的清华云盘邮箱；缓存账号与 `allowEmail` 不符时先强制刷新账号再判。
- 短码转发（`cloudExchange.resolveExchangeCode`）原来只带 name/cloud，
  会把新字段丢掉；已补 label/allowEmail/expiresAt。

## 二、组织完整页面（page=org）

新增一级页 `page=org`（`navParams.orgId`；无 orgId 时是组织选择页），
入口：通讯录「我的组织」列表行 / 名片夹里的组织卡 / 搜索「组织」。

页面结构（`pages/Organization.tsx`）：

- **概览**：成员数/邮箱绑定数、负责人、资料库、GitLab 仓库、加入方式；
  最近邀请口令（可改名/限定邮箱、二维码）；组织名片；删除组织（只删本地记录）。
- **成员**：真实清华云盘邮箱（添加/编辑/按邮箱去重）；角色（负责人/成员/访客）；
  「把资料库共享给全体成员」。
- **资料库**：清华云盘**资料库（repo）**，不是组织页里的文件夹——
  新建资料库（`seafile_create_repo`）、关联已有资料库、共享给成员邮箱
  （`seafile_share_folder_to_user` 根目录）、复制 7 天分享链接、打开（云盘页 deep link
  `navParams.cloudRepo`）、解除关联（不动云盘）。
- **GitLab**：新建仓库（`POST /api/v4/projects`）、按 `group/project` 关联已有仓库
  （`GET /api/v4/projects/:encoded`）、打开仓库（`navParams.gitlabProject`）、解除关联。
  info-lib 新增 `getGitProjectByPath` / `createGitProject`（复用其 cookie+CSRF 写通道）。
- **项目 / 公告**：沿用旧组织工作区能力，迁到整页 tab。
- 邀请口令：可起名、可限定接收邮箱（`org.invite` 记录）；同一组织复用同一条短码，
  改名称/邮箱只更新云 manifest（stable slot `org:<id>`）；接收方过邮箱校验才加入，
  并以邮箱身份成为成员。

数据模型（`state/org.ts`）：`OrgMember.email`、`Org.libraries[]`、`Org.gitlabRepos[]`、
`Org.invite`。旧存档迁移只补默认值（成员 `email: ""`、两个数组置空），不丢历史数据。
旧的组织管理弹层 `OrganizationWorkspace.tsx` 退役；名片夹组织卡不再弹卡片详情，直接进组织页。

## 三、测试与证据

- `node tools/org-browser-test.mjs` → 21 条（假云盘：建组织→完整页→成员邮箱→
  邀请限定/复用短码→资料库 repo+按邮箱共享→GitLab 入口→删除）。
- `node tools/vault-browser-test.mjs` → 48 条（新增：口令改名后解码校验、
  限定邮箱后他人被拒/本人可收）。
- `node tools/namecard-browser-test.mjs` → 14 条（组织卡点击进入组织页）。
- experience / short-share 49 / schedule / mobile-vault 14 / feedback-repairs 均绿；
  `pnpm guard` 全绿（含 typecheck）。
- 截图：`docs/onegui/experience-mode/org-page-{overview,libraries,phone,phone-overview}.png`。

## 四、已知边界

- GitLab 的新建/关联需要 GitLab 会话（测试环境未登录，只验 UI 骨架）。
- 云盘资料库共享需要云盘 token；未连接时页面给「去连接云盘」入口。
- 口令「有效期」目前仍按生成时 7 天（台账可看），改有效期未做（要重新生成）。

## 五、2026-10-19 续：自动共享 / GitLab 组织 / 页内预览 / 口令有效期与删除

### 自动共享（用户：「自动分享给成员 云盘 和 gitlab 呢」）
- 新建/关联资料库 → 自动把资料库（repo 根目录）按成员邮箱共享（`seafile_share_folder_to_user`），
  已共享过的不重复发；成员页仍有「同步云盘与 GitLab 权限」一键全量同步。
- 新建/关联 GitLab 仓库、新增成员/改邮箱 → 自动按邮箱搜 GitLab 用户
  （`GET /users?search=`）并加进 GitLab 组织与仓库（30 developer / 20 reporter），
  已是成员（409/400）按成功算；搜不到的邮箱提示手动加。

### 创建组织仓库 = 创建 GitLab 组织（用户：「不是创建仓库，而是直接创建一个 gitlab org
自动关联/邀请所有用户」）
- `Org.gitlabGroup`（id/name/path/webUrl）。「建 GitLab 组织与仓库」先 `POST /groups`
  建组织（名称取组织名、path 自动 slug），邀请全体成员进组织，再把仓库建在该组织
  命名空间下（`namespace_id`）；之后是「在组织下新建仓库」。
- info-lib 新增 `createGroup` / `addGroupMember` / `searchUsers` / `addProjectMember`。

### 页内预览（用户：「也可以直接预览组织云盘文件和组织项目」）
- 资料库卡片「预览文件」：内联文件树（`openDir`，可进文件夹/刷新）+
  文件预览弹层：文本直接渲染、图片 data URL、其他/超大给「下载到本机」
  （`seafile_read_bytes`，内存读取不落盘）。
- GitLab 仓库卡片「预览项目」：内联项目详情（描述/默认分支/可见性/star/
  未关闭 Issue/最近活动）；两卡都补「浏览器打开」。

### 入口收口（用户反馈「点上去莫名其妙的组织页面，啥也点不进去」）
- 删除「组织」独立搜索原子与功能目录注册项：组织页必须带 orgId 从组织卡片/列表进入；
- 载入标签页时丢弃无 orgId 的裸 org 标签；带 orgId 但组织已不存在时显示
  「找不到这个组织」明确出口；独立落地页补「用邀请口令加入」。

### 组织邀请口令：有效期可改、可删除（用户：「组织口令应该也可以改有效期！可以删除！」）
- `publishExchangeCode(code, contentKey, slot, {expireDays, forceNew})`；
  `uploadExchangeManifest(code, expireDays)` 不再硬编码 7 天（0 = 不过期）。
- 云盘分享过期时间创建时定死：改有效期时撤销旧分享（`revokeShareSlot` 删分享 + 清槽位
  + 清内容缓存）再重建，短码随之更新；有效期不变（2h 容差）继续复用同一条短码。
- 组织页邀请表单加有效期（1/7/30 天、不过期），概览显示到期时间，
  「删除口令」= 撤销云盘分享 + 清本地 invite/lastInviteCode。

### 测试
- org 28 条（新增：新库自动共享邮箱、云盘文件内联预览、改有效期换新码、删除口令
  清记录且云盘 share 数 -1），namecard 14、experience、mobile-vault、feedback 等全绿；
  `pnpm guard` 全绿。
- 截图：`org-page-*`、`org-lib-preview-list/text.png`。
