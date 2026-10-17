# OneTHU 新版本扩展：组织、暂存箱与分享口令（已排队，暂不实现）

> 2026-10-18 用户定案：本计划**先存档，不立刻开工**。当前优先收尾 OH / OneFlow / OnePage / OH MCP 的路由与操作审计修复；揪完虫子后再逐步实施本计划。
> UI 口径：继续 Codex / GPT 式美式简约，不另起一套视觉语言。

## 0. 总目标

在现有 OneTHU 上增加三个互相配合的能力：**轻量组织**、**万物暂存箱**、**万物分享口令**；并补齐**我的 OneTHU 名片**与**手机碰一碰**、**通讯录/共享云盘**。尽量复用清华现有服务（清华 GitLab、清华云盘、网络学堂、清华邮件），不自建额外后端。

## 1. 轻量组织（Group）

- 用户可建立组织、邀请成员，围绕学习 / 项目 / 兴趣协作。
- 初期不要求复杂独立后端：用清华 GitLab（组织仓库/Issue/成员权限）、清华云盘（共享资料）、网络学堂、清华邮件等现有服务承载。
- 组织需要一张**组织名片**（见 §6），也是邀请的具体化形式。

## 2. OneTHU 暂存箱：万物皆可收纳

- 通用内容容器，可混合收纳：白板、组件、文字、文件、课程、作业、邮件、新闻、待办、日程、设置、主题、壁纸、体育信息、图书馆资源、研讨间/公共空间预约情况、选课信息、插件、群组邀请等任意对象。
- 清华云盘承担实际文件存储与中转；**内容哈希**识别相同内容，避免多个暂存箱重复存同一份文件。
- 暂存箱本身是一份可编辑的内容清单（含对象引用 + 必要元数据），不是把所有内容塞进一个文本。

## 3. OneTHU 口令：万物皆可分享

- 任何暂存箱都可生成分享口令：本质是**清华云盘分享地址 + 必要识别信息的编码封装**（不是超长明文）。
- 接收方把口令交给 OneTHU → 识别口令 → 读取内容清单 → 解析对象 → 加入自己的 OneTHU。
- 每个口令对应独立分享文件夹；用清华云盘权限机制管理分享范围、有效期与撤销。
- 口令过期/撤销后：校验时自动清理对应分享文件夹；实际共享文件只有在**不存在其他有效引用**时才彻底删除（引用计数/哈希去重）。

## 4. 口令与暂存箱的关系

- 口令可转换为“当前暂存箱”，让分享内容直接成为用户正在编辑/组织的内容。
- 若当前暂存箱内容从未被任何口令收录：暂存箱被替换/删除时，这部分内容立即抹除，不作为独立永久存储保留（临时工作区语义）。

## 5. 整体目标

- 组织：把成员组织起来，建立协作关系。
- 暂存箱：把任意类型内容统一收纳。
- 口令：把内容方便地分享、传递、导入。
- 云盘 + 去重：承担存储、分享中转与内容复用，尽量不重复占空间。
- 最终形成一套**不依赖自建后端**、利用现有清华服务运转的组织与内容流转体系。

## 6. 我的 OneTHU 名片

- 用户自行设置：**头像、个人网址、社交媒体、手机号、个人简介**（仅这几项，保持简单）。
- 手机号等敏感项需显式控制是否随名片发出。
- 组织名片 = 组织邀请的具体化形式（名称、简介、加入方式/GitLab 组织或共享文件夹入口等）。

## 7. （手机）碰一碰

- 调用 NFC 能力；碰一碰时选择要传递的组合：
  1. 当前暂存箱口令；
  2. 个人名片；
  3. 组织名片（邀请）。
- 发出者可任意选择三者中的组合；**后两者太长时可以直接一起变成口令**（统一走口令编码）。
- 通讯录：
  - 存储组织名片与接受的好友名片；名片展示/交换配炫酷但克制的动画（美式简约）。
  - 加好友后直接成立二人共享云盘：通过该通道放口令 / 留言 / 直接放文件 / 作业 / 分享等。
- 因为上述能力高度依赖清华云盘，本版本起**强制使用清华云盘，不再允许断开**（设置里的断开/停用入口需移除或改为不可用说明）。

## 7.5 手机版 UI / 交互与动效（用户 2026-10-18 追加）

这一层不是附属品，**很可能需要大改手机版 UI**。实现时单列一个阶段，并纳入验收。

- **任意元素拖入暂存箱**：从首页卡片、搜索结果、聊天消息、邮件、文件、课程、作业、新闻、日程、设置项等任意可识别元素发起拖动；拖动中要有拾取反馈（缩放/抬升/跟随手指的浮层），暂存箱作为常驻拖放目标出现（手机底部悬浮胶囊/圆环），按接近距离高亮、吸附、触感/动效确认。
- **拖放识别**：需要统一的“可拖元素 → 对象类型/引用”识别层（DOM 标记 + 对象类型注册表），拖拽数据只带引用与摘要，不复制内容；非法/不可收纳对象要有明确拒绝反馈。
- **动画**：元素被吸入暂存箱的收拢/压缩动画；暂存箱自身开合、内容滚动、批量收纳的层叠动画；错误回弹；从暂存箱拖出/放入白板的反向动画。动效遵守既有设计规范（时长/缓动 token，避免炫技），并支持 `prefers-reduced-motion`。
- **暂存箱页面/抽屉**：手机贴底抽屉 + 桌面侧板/浮层两种形态；混合对象列表、类型筛选、批量选择、生成口令入口。
- **名片/碰一碰动画**：名片展开/翻转/交换动画；NFC 碰一碰成功后的收拢/传递动画；好友建立后的共享云盘入口动效。保持美式简约，不堆特效。
- **无障碍/性能**：拖动过程不阻塞主线程；长列表虚拟化/懒渲染；键盘与读屏用户要有“加入暂存箱”的菜单替代路径。

## 7.6 对象可拖性 / 统一中转 / 课程共享 / 文字获取（用户 2026-10-18 追加）

关键前提：**很多提到的元素现在根本不是可拖动组件**。不能假设「拖一下就有了」，以下全部需要从零调研并抽象出公共基础层：

- **对象可拖性普查**：逐类盘点白板卡片、搜索结果、邮件/新闻、课程/作业/通知/文件、日程、设置项、主题、壁纸、体育/图书馆/研讨间/选课信息、插件、邀请等：现在是什么 DOM/组件、有没有稳定引用、是否可选中/长按、滚动与手势冲突、桌面与手机差异。结论要落成「可拖来源登记表」。
- **统一拖拽识别层**：`data-vault-catch` 只是入口协议；必须有对象类型注册表（kind → 提取器/标题/副标题/去重键/打开方式），来源方只声明「我是什么对象」，不能各自拼 payload。
- **统一文件中转系统**：文件不是「拖进来就完事」——需要统一的上传/下载/哈希/引用/云盘路径/分享中转（本地临时 → 清华云盘 → 分享文件夹），断点/重试/去重/引用计数/失败回滚；桌面文件、剪贴板文件、手机分享面板、云盘已有文件都走同一条通道。
- **课程共享方略**：课程/作业/通知/文件等网络学堂对象需要明确的分享口径（分享引用还是分享快照、权限与过期、作业红线、附件版权/大小限制），不能简单当普通文件传。
- **文字获取**：选中的正文、卡片标题/摘要、邮件正文、新闻正文、笔记等如何提取成暂存箱文字对象；要处理富文本/HTML 净化、长度上限、来源指纹、去重。
- **全部提到元素都能长按拖动**：手机端长按识别要逐类适配（不能拖的做成「收进暂存箱」菜单兜底）；拖动中的滚动锁定、边缘自动滚动、拖出应用/进入系统分享的边界都要定义。
- 上述调研结论先写进 `docs/plans/` 子文档再动工；实现顺序上调到暂存箱 UI 之前（基础层先行）。

## 8. 实施顺序（建议，待排期）

0. **对象可拖性普查 + 统一拖拽识别层 + 统一文件中转 + 课程共享方略 + 文字获取**调研（基础层，先出调研文档再写代码）。
1. 云盘强制化 + 现有 OneTHU 内容引用模型梳理（对象类型注册表、哈希/引用计数）+ **手机拖放/动画基础设施评估**。
2. 暂存箱数据模型 + 本地/云盘清单同步 + 内容哈希去重。
3. 口令编码/校验/撤销/清理（分享文件夹生命周期）。
4. 名片（个人/组织）+ 通讯录 + 好友共享云盘通道。
5. 组织（GitLab/云盘承载）+ 邀请流程。
6. NFC 碰一碰（Android 优先）+ 分享组合选择 + 动画。
6.5 手机 UI 大改：全局拖动识别层、暂存箱吸附/吸入动画、暂存箱抽屉与名片/NFC 动效；逐项在 390/320 宽度回归。
7. UI 统一走 OneGUI / Codex-GPT 简约风格；补浏览器/原生回归与文档。

## 9. 验收要点（草案）

- 暂存箱可混合装入任意已注册对象类型；同一文件重复放入不同暂存箱不重复占用云盘。
- 口令可跨账号导入；过期/撤销后本地校验即清理分享文件夹；无引用文件才删。
- 名片可编辑、可选择性分享；碰一碰能选三种内容的任意组合；通讯录可存组织/好友名片。
- 好友通道能直接放文件/作业/口令/留言；云盘断开路径被移除且 UI 说明清楚。


## 9. 进度（2026-10-18 Phase 1：暂存箱地基）

已落地（提交见 git log）：
- `state/vault.ts`：多暂存箱、混合对象清单（atom/text/file/board-item/payload）、去重、持久化、订阅、文件 hash 索引。
- `state/vaultShare.ts`：`ONV1.<base64url>.<checksum>` 口令编码/校验/解码；云盘适配器接口（未注册时 inline，注册后只编码云盘引用）；导入为当前暂存箱；撤销接口。
- `components/vault/vaultDrag.ts`：全局 `data-vault-catch` 拖动识别（鼠标 6px / 触屏 320ms 长按）、ghost、`[data-vault-drop]` 命中、吸入动画、点击吞掉、重复检测。
- `VaultPage`：箱子切换/新建/重命名/清空/删除、清单展示/移除、生成/复制/导入口令；页面路由 `vault`（Page/TOP_PAGES/KNOWN_PAGES/renderPage/nav registry/PAGE_ATOMS/TabStrip icon）。
- 搜索结果（CommandPalette）已接入 `data-vault-catch`；OneGO 增加「暂存箱」入口。
- 回归：`tools/vault-browser-test.mjs` 12 条断言（路由、拖入、去重、口令形状/校验/篡改拒绝、导入替换）。
- CSS 走 `packages/gui/src/recipes/workbench.css` 令牌；桌面/手机 bottom 位置、reduced-motion 已处理。

明确未做（后续阶段）：
- 云盘适配器实现（上传清单/分享文件夹/权限/撤销/引用计数）；当前 inline 口令适合小箱子。
- 除搜索结果外的拖拽来源（白板卡片、邮件/新闻/课程/文件/文字选取等）与手势冲突仲裁；文件/文字/课程共享方略待调研报告。
- 名片、组织、NFC、通讯录、强制云盘。


## 10. 调研结论（2026-10-18，Phase 2 前置）

两份只读调研已入库：
- 云盘/文件/口令/课程/文字：[seafile-vault-capabilities](../research/2026-10-18-seafile-vault-capabilities.md)
- 手机拖放/动效/NFC：[mobile-drag-nfc](../research/2026-10-18-mobile-drag-nfc.md)

### 10.1 云盘（决定）

- 现有 Seafile 能力够用但不完整：上传/下载/分享创建可用；**分享链接查询/撤销/密码 UI 缺失**、无内容哈希、无文件通道进度/取消、无回收站、无好友共享 API。
- **先做**统一文件通道 + Rust 流式 `file_sha256` + 持久化 transfer 队列；**不要**把同名 replace 当秒传。
- 分享口令 Phase 2：`ONV1` 兼容读，新增 `ONV2`（sha256 摘要、过期、白名单/长度上限、只带云盘引用）；云盘适配器需 live 验证「目录分享 / 密码 / 有效期 / 撤销」，不通过则退化为单文件 manifest 分享。
- 强制云盘策略：**本地读可用，写/分享/新文件强制云盘**；移除断开入口、启动失败阻塞式连接、换账号清 token。单独批次实施，先避免破坏现有同步。
- 课程/作业/通知/文件只分享「引用 + 标题/DDL」；作业答案、提交、成绩、正文、会话 URL、OJ 一律不进清单；默认 7 天有效期。
- 文字对象正文 ≤4KB、标题 ≤120 字、摘要 ≤512 字；不存 innerHTML；剪贴板敏感提示。

### 10.2 手机（决定）

- 现有拖拽是 4 套自写 Pointer，长按阈值 300/450/500ms 并存；**没有统一手势竞技场**。新 UI 基础层先做 `lib/catch/`（提取器 + 竞技场 + 注册表），不允许多套阈值继续扩散。
- 统一口径：通用长按 380–420ms、8–10px 容差；强语义拖（白板/标签/轮播）优先；未武装不吃滚动；拖拽中底栏 `pointer-events:none`。
- 暂存箱落点：独立 fixed 层（底栏之上、sheet 之下），不挤底栏三槽；拖拽时展开，`<120px` 高亮、`<64px` 吸附，触感确认。
- 手机拖出 WebView 不能跨应用；跨应用走分享面板/ACTION_SEND，首版不承诺系统拖出。
- NFC：Android HCE + ReaderMode（Beam 已废弃）；无可用的三端降级方案（二维码/口令/剪贴板）；NDEF 只接受带校验的 `ONV1.`，不自动打开任意 URL。
- 已知 P0 先修：motion 护栏红、手机根返回命令缺失、`is-phone/useExpanded` 横竖屏判定不一致、长列表无虚拟化、读屏替代路径。

### 10.3 Phase 1.5 已落地（本轮）

- `CollectStar` 统一接 `data-vault-catch`：邮件/新闻/课程/作业/通知/文件/体育/图书馆/研讨间等 60+ 收藏点直接成为拖拽来源。
- OH 搜索窗（设置行/功能/原子）与命令面板设置行接入拖拽；共享 `vaultRegistry` 负责「点条目打开/失效提示」。
- 口令解码加体积/条目/字段白名单与过期校验；分享清单不再携带发送者私有 `cloudPath`。
- 已知限制：`CollectStar` 拖动与自身点击的竞技场尚未统一（先依赖 6px/320ms 阈值）；文件/文字/白板卡片/日程/主题/壁纸/设置行（非搜索）仍待接。


## 11. 进度（2026-10-18 第 2-3 阶段：文件通道 / 云分享 / 名片）

- **Phase 2.1 文件通道**：`lib/fileChannel.ts` 统一 stage（文件选择/File[] → 字节 → SHA-256 →
  `write_temp_file` 暂存），暂存箱文件条目按 hash 去重；VaultPage 支持「添加文件」与拖放落区。
- **Phase 2.2 云盘适配**：Rust 新增 `seafile_share_delete`（撤销）与 `seafile_share_read`
  （匿名读分享 manifest）；`state/vaultCloud.ts` 实现资料库 `OneTHU` / `/Vault/shares/<id>/`
  独立目录、清单上传、7 天分享、接收端读回、撤销；有 token 才注册，否则 inline。
  VaultPage 显示「云分享/本地口令」与「撤销云分享」。
- **Phase 3 名片地基**：`state/nameCard.ts` + `NameCardSection`：个人名片（头像/网址/社交/
  手机号/简介 120 字）、组织名片、通讯录；名片作为 payload 进暂存箱，点开即收进通讯录
  （自名片/重复去重）；routes.json 62 行。
- **手机**：常驻暂存箱入口（底栏之上独立层，显示数量）已上线；390 宽长按拖动/落点回归通过。
- **测试**：`vault-browser-test.mjs` 26/26（含云引用/撤销、手机 dock/长按、hash 去重）；
  `namecard-browser-test.mjs` 7/7；typecheck/build/guard:onegui/docs 通过。

仍未做：ONV2 摘要、分享文件夹/文件引用计数 GC、真实清华云盘 live 冒烟、组织成员/邀请流程、
通讯录好友共享云盘、Android ACTION_SEND/NFC（HCE+Reader）、名片/NFC 动画、手机统一手势竞技场。


## 12. 进度（2026-10-18 组织 + 碰一碰组合）

- **轻量组织**：`state/org.ts`（组织/成员/ONORG1 邀请口令/接受合并去重）+ 设置「账号 → 我的组织」
  （建组织/加成员/生成复制邀请/用口令加入/删除）；routes.json 64 行；org 浏览器回归 8/8。
- **碰一碰组合**：`state/touch.ts`（ONTOUCH1：暂存箱口令 + 个人名片 + 组织邀请任意组合，
  统一校验/解码/导入）；VaultPage「碰一碰组合 / 收碰一碰」已上线，NFC 接入前用口令/二维码替代；
  回归覆盖生成/携带/接收导入（vault 29/29）。
- **白板卡片兜底**：卡片长按菜单新增「收进暂存箱」（手机 stack 只点按、不能直接拖动时的替代路径），
  写入 board-item 引用；`tools/board-edit-test.mjs` 增加护栏。
- 仍未做：真实 NFC 原生（HCE+Reader）、通讯录好友共享云盘、组织云盘空间/GitLab 组织创建、
  名片/NFC/暂存箱动画、手机统一手势竞技场、ONV2/引用计数 GC。


### 12.1 强制云盘第一批（2026-10-18）

- 云盘页移除「断开」入口，明确「云盘为必需组件」；不再提供断连按钮。
- 登出时清空云盘 token（`lib/clients.ts logout` 动态导入 `clearSeafileToken`），防共享设备换账号串数据。
- 暂存箱未连接云盘时显示「本版本要求连接清华云盘」横幅 + 去连接入口；本地引用仍可读，云分享不可用。
- 回归：vault 29/29、namecard 7/7、org 8/8；guard/docs 通过。


### 12.2 好友共享云盘（2026-10-18）

- `lib/cloudFolder.ts`：确保资料库 `OneTHU`、建目录、上传 README、分享目录；目录分享被策略
  拒绝时退化为分享 README 文件。组织空间后续复用。
- 通讯录联系人新增 `shared` 字段；`NameCardSection` 每位联系人可「共享云盘」（建
  `/Friends/<contactId>/` 并复制链接）或「复制链接」；没有云盘 token 时明确报错。
- 待 live 验证：清华实例目录分享是否放行；好友加入后双方文件/口令投递 UI 尚未做。


### 12.3 组织共享空间 + 暂存箱动效/二维码（2026-10-18）

- 组织行可「共享空间」：云盘 `/Orgs/<orgId>/` + README + 分享链接（目录分享失败退化为文件分享）；
  Org.shared 记录链接，成员可复制加入。
- 暂存箱条目入场（m-rise）、落点出现（m-pop），都走既有运动令牌并尊重 reduced-motion。
- 口令/碰一碰口令支持二维码展示（NFC 接入前的扫码兜底；扫码器尚未实现）。
- 回归 vault 29/29、org 8/8、namecard 7/7；guard/build/docs 通过。


### 12.4 ONV2 口令（2026-10-18）

- 新生成口令升级 `ONV2.<base64url>.<sha256 前 32 hex>`；`decodeShareAsync` 同时兼容 ONV1 旧口令。
- 分享/碰一碰链路统一走 ONV2；云分享仍只编码云盘引用，不塞清单。
- vault 回归 30/30（ONV2 形状、ONV1 向后兼容、篡改/过期拒绝）。
- 仍未做：云盘分享清单的文件引用计数 GC、真实清华云盘 live 冒烟。


### 12.5 云分享带文件（2026-10-18）

- Rust `seafile_share_read` 支持指定清单文件名；`VaultCloudRef.manifestName`。
- `vaultCloud.upload`：文件条目先按 hash 前缀上传到 `/Vault/shares/<id>/files/`，清单写相对路径；
  优先分享整个目录（接收端既拿清单也拿文件），目录分享被拒时退化为分享 manifest 文件。
- 接收端 `resolve` 按 manifestName 读清单；`cargo check`/typecheck 通过，真实云盘目录分享仍待 live。


### 12.6 手势竞技场 + NFC 接收（2026-10-18）

- `lib/gestureArena.ts`：统一通用长按阈值 400ms / 手抖 8px / 鼠标 6px，单所有者 claim/release；
  暂存箱拖动已改用该阈值；`tools/gesture-arena-test.mjs` 9/9。旧面（白板 500ms、标签条 300ms、
  胶囊 450ms）仍各自为政，后续批次逐个接入。
- NFC 接收（Android）：`onethu-mobile` Kotlin 增加 `nfcAvailable`/`nfcReadTag`（ReaderMode，
  10s 超时，NDEF 文本/URI 解析），manifest 加 NFC 权限/feature；Rust 增 `nfc_available`/
  `nfc_read_tag` 包装命令；`lib/nfc.ts` + 暂存箱「NFC 接收」按钮：读到 ONTOUCH1/ONV 直接导入。
  桌面端恒不可用；**发送端 HCE 服务**与真机验证仍待做。
- 构建：cargo check / typecheck / Vite build / guard / docs 通过；vault 30/30。


### 12.7 分享引用账本与过期清理（2026-10-18）

- `state/shareRefs.ts`：记录每条云分享引用的文件（hash + 云盘路径），同 shareUrl 去重更新；
  提供有效/过期分享、撤销、无引用文件计算、hash 是否仍被引用。
- vaultCloud 上传时自动记账；撤销时先撤分享链接，再只删无其他有效引用的文件；
  启动时 `cleanupExpiredVaultShares()` 清理过期分享（失败留待下次）。
- `tools/share-refs-test.mjs` 8/8；目录清理（空文件夹/清单）与真实云盘 live 冒烟仍待做。


### 12.8 名片/NFC 动效（2026-10-18）

- 名片区 `m-spring-in` 入场、二维码 `m-pop`、NFC 读取时按钮 `m-breathe` 呼吸；全部尊重
  reduced-motion，只动 transform/opacity。
- 下一步：NFC HCE 发送端（Android HostApduService + NDEF AID）与真机双机验证。


### 12.9 NFC HCE 发送端（2026-10-18）

- Android `NfcHceService`：NDEF tag application AID `D2760000850101` 的最小只读实现
  （SELECT AID / SELECT CC(E103)/NDEF(E104) / READ BINARY，NLEN + NDEF 文本消息）；
  `res/xml/nfc_apdu_service.xml` + manifest service 声明；插件命令 `nfcShareText` 设置载荷。
- Rust `nfc_share_text`（mobile 插件 / desktop 不支持）；`lib/nfc.ts`；暂存箱碰一碰口令区
  增加「NFC 发送」按钮（Android 且 NFC 开启才可用）。
- 尚缺：HCE 协议真机双机联调（AID 路由/默认付款应用选择、NDEF 分块读取兼容性）、
  发送后自动关闭、HCE 生命周期与前台服务限制。cargo check/typecheck/vault 30/30 通过。


### 12.10 分享目录清理（2026-10-18）

- 撤销云分享：删分享链接后，优先递归删该分享独立目录（`seafile_delete kind=dir`），
  失败再退化为只删无引用文件；过期清理复用同一路径。避免留下空目录/孤立文件。


### 12.11 强制云盘生成门槛 + 手机暂存箱/名片回归（2026-10-18）

- `allowInlineShare()`：正式用户无云盘时禁止生成分享/碰一碰口令（提示先连接）；预览/开发模式
  `?explorer-preview` 或 `onethu.dev.inlineShare=1` 保留本地调试能力。导入不拦。
- 新增 `tools/mobile-vault-browser-test.mjs` 13/13：390 暂存箱/dock/二维码/设置名片组织无横向
  溢出；320 设置仍可用；与 vault 30/30 一起覆盖手机主路径。


### 12.12 扫码接收脚手架（2026-10-18）

- `lib/qrScan.ts`：BarcodeDetector 识别图片二维码（不做实时相机预览）；暂存箱「扫码接收」按钮
  选图 → 识别 → 走同一 receiveText 分支（ONTOUCH1/ONV1/ONV2/ONORG1）。
- 二维码展示尺寸从 148 提到 240，便于手机互扫；**端到端识别/真机相机流程尚未验证**，
  Chromium 无头下截图识别测试不稳定，未纳入回归。


### 12.13 好友通道（2026-10-18）

- `state/friendChannel.ts`：本地消息账本 + 有共享云盘时把留言写成 txt、文件上传到
  `<shared>/messages/`；无云盘/网络失败仍保留本机留言并如实提示。
- 通讯录联系人增加「通道」：查看留言、留言、传文件、关闭；消息显示是否已写入共享云盘。
- `tools/friend-channel-browser-test.mjs` 6/6（打开通道、本机留言、提示、列表）。
- 限制：公开分享链接只读，真正的双向通道需要清华云盘账号级共享 API（尚未接入）。


### 12.14 设置行兜底 + 桌面文件拖入（2026-10-18）

- vaultDrag 增加两级识别兜底：`[data-set-id^="row-"]` 设置行（标题 → payload；点开时按标题
  反查检索行）与旧 `data-ctx-atom`；设置行无需逐条挂 data-vault-catch 也能拖入暂存箱。
- VaultDropTarget 增加 OS Files 拖入：全屏提示层、松手 stage + SHA-256 + 去重入箱；
  无其他文件落地点的页面可直接拖文件进应用。
- vault 回归 34/34（设置行拖动、OS 文件拖入/哈希）；guard/build 通过。


### 12.15 主题/壁纸也能收纳（2026-10-18）

- ThemeChoice 增加 themeId 与 data-vault-catch；WallCell 增加壁纸 payload（builtin/local ref）。
- vaultRegistry 支持 payload.kind=theme/wallpaper：点开暂存箱条目直接应用主题/壁纸；
  vault 回归 35/35（主题 payload 实际改写 data-theme）。


### 12.16 插件/主题对象补齐（2026-10-18）

- 插件卡挂 data-vault-catch（payload.kind=plugin）；主题选择挂 themeId；壁纸挂 ref。
- vaultRegistry 打开插件引用 → 打开插件页；主题/壁纸直接应用。
- vault 回归 37/37（增加插件/主题来源静态断言）；guard/build 通过。


### 12.17 选中文字收纳（2026-10-18）

- 选中文字按 ⌘/Ctrl+Shift+S 收进暂存箱（文字没有可拖 DOM，提供快捷入口）；正文 ≤4000 字，
  标题取前 40 字，来源标「选中文字」。
- VaultPage 提示补充该快捷键；vault 回归 38/38（真实选区 → 快捷键 → 入箱）。


### 12.18 二维码健壮性与组织邀请码扫码（2026-10-18）

- decodeQrFile 加 8s 超时（部分 WebView 的 BarcodeDetector.detect 可能不 resolve）；
- 组织邀请口令显示二维码（200），成员可直接扫；org 回归 9/9。


### 12.19 暂存箱回到首页（2026-10-18）

- 原子类暂存箱条目增加「放进首页」：调用 addAtomToHome 写回首页白板，保留暂存箱副本。
- vault 回归 39/39（放进首页后 localStorage 白板含该 atom）。


### 12.20 真实清华云盘 live 验证与修正（2026-10-18）

- 用真实 token 跑通 `tools/cloud-smoke-live.mjs`（11 步）：目录分享、匿名 dirent_list、
  匿名下载、撤销后拒绝、单文件分享 direct 读取、清理。
- Rust `seafile_share_read` 按实测修正：匿名目录响应是 `dirent_list` 且字段
  `file_name/is_dir`；单文件分享链接是 `/f/<token>/`，dirents 400，改走 direct 文件通道。
- 新增 `seafile::tests::live_share_read_dir_and_file`（ignored，需 TSINGHUA_SEAFILE_TOKEN），
  实测目录分享与文件分享直读均通过。
- 研究文档 §实测补充 记录 API 形状；下一轮可跑 App UI 端到端云冒烟。


### 12.21 App 层真实云盘 UI 端到端（2026-10-18）

- 新增 `tools/cloud-ui-live-test.mjs`：浏览器里用本地 Tauri 命令桥接真实云盘，走 UI「生成口令」→
  第二上下文「导入口令」→ 校验云端目录含 manifest + files、导入文件 ref、撤销分享；9/9 通过。
- 修出两个真实 bug：
  ① `payloadFromVault` 之前把 `stagedPath` 剥掉，云适配器根本拿不到本地文件 → 改为仅云适配器
     上传时携带，上传后立刻删除，绝不进清单/inline 口令；
  ② 清单临时文件名不是 `manifest.json` → 改为 `write_temp_file("manifest.json")`，目录分享可直读。
- 实测确认：文件条目上传到 `<分享目录>/files/`，第二上下文导入保留 `files/...` 云路径；
  分享撤销后清理目录。


### 12.22 UI 撤销云分享 live 验证（2026-10-18）

- `cloud-ui-live-test` 增加「撤销云分享」按钮点击：share ref 标记 revokedAt、匿名分享链接拒绝、
  分享目录在云盘被递归删除（403/404 视为已删）。
- 结果 11/11 通过；清理临时目录/分享链接。


### 12.23 动效护栏转绿 + 页面方向恢复（2026-10-18）

- 修复 TabHost 丢失 `useNavDirection`/`data-dir`：进二级页/返回顶层重新有方向，`.page-anim` 转场生效。
- motion-test 从红转绿（142 断言）：正确处理 MD3 变量时长/缓动、OneGUI Modal 单源动效、
  已删/已迁移的旧类断言（折叠组、nav-indicator、日程 inline 退场等），并更新 Ripple 护栏为“由
  Ripple.tsx 安装”。
- vault 39/39、mobile 13/13 回归通过。


### 12.24 手机根级返回退出补齐（2026-10-18）

- `navStack` 一直调用 `plugin:onethu-mobile|mobile_exit`，但 Kotlin 未实现、ACL 未授权；
  现补 `mobileExit`（finishAffinity）、默认权限 `allow-mobile-exit`、命令 permission 文件。
- 新增 `tools/mobile-nav-test.mjs` 4/4：前端命令 / Kotlin finish / default 权限 / 命令 permission 四方一致。
- 真机返回键验证仍待做（无设备）。


### 12.25 扫码识别放大兜底（2026-10-18）

- decodeQrFile 先原图识别，失败后 2x 放大（≤2048px）+ 白底再识别；仍识别不到就返回空，
  8s 超时不再无限转圈。二维码展示尺寸提到 300（390 手机宽度内）。
- Chromium 无头对高密度 ONTOUCH1 截图仍识别不到，自动回归未纳入；真机相机/截图待验证。
- mobile_exit 命令四方位（前端/Kotlin/default 权限/命令 permission）已有护栏 4/4。


### 12.26 验证矩阵文档（2026-10-18）

- 新增 `docs/audit/2026-10-18-vault-share-verification.md`：自动化回归、真实云盘 live、
  仍待真机/第二账号验证的事项分开列清，作为 goal 完成口径。


### 12.27 好友双向共享 API 接线（2026-10-18）

- 新增 `seafile_share_folder_to_user`（PUT `/api2/repos/{id}/dir/shared_items/?p=...`，
  share_type=user/username/permission），Rust 注册、TS `seafileShareFolderToUser`。
- 名片新增可空「清华云盘邮箱」；好友共享云盘创建后若对方有邮箱，自动开通 rw 双向权限，
  或联系人行点「开通双向」；`ContactCard.shared.sharedWith` 记录。
- live 验证：分享给 owner 自己被服务端拒绝（命令/API 接线正确，`live_share_folder_to_user_owner_rejected`
  1 passed）；成功路径需第二真实账号，尚未验证。
- namecard 7/7、friend channel 6/6、vault 39/39、mobile 13/13；guard/docs/build 通过。


### 12.28 Android Kotlin 真编译修正（2026-10-18）

- 用现有 Android Gradle 工程实际编译 Kotlin，发现 NFC 读取引用了错误包
  `android.nfc.Ndef`（不存在）；正确类是 `android.nfc.tech.Ndef`。
- 修正后 `:tauri-plugin-onethu-mobile:compileDebugKotlin` 与 `:app:compileArmDebugKotlin`
  均 BUILD SUCCESSFUL，证明 HCE/ReaderMode/mobile_exit 代码至少能过 Kotlin 编译。
- 真机/模拟器运行与双机 NFC 仍未验证。


### 12.29 Android 实编译 + 模拟器冷启动（2026-10-18）

- 用 NDK 27 + Gradle 实际编译：Kotlin 插件/app 均 BUILD SUCCESSFUL；debug APK 打包成功。
- 模拟器 `onethu-demo` 安装并冷启动成功，进入登录页；返回键退出进程无崩溃。
- 关键环境：必须显式导出 NDK linker/CC（详见 `docs/audit/2026-10-18-android-build-runbook.md`）。
- 模拟器无 NFC，真机双机 NFC 与登录后功能仍未验证。
