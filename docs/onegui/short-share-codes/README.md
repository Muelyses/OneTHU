# 联网短口令 · 收尾记录（2026-10-19）

> 最后更新：2026-10-19 12:17

接手 codex 的未提交工作（先整笔留档 `026a3f1b`：`shortCode`/`cloudExchange` 主体 + 各入口改造，类型检查已过但未验收），按用户反馈收尾。本目录是本轮的证据与截图。

## 用户原话与对应处理

| 用户反馈 | 根因 | 处理 |
|---|---|---|
| 「网盘仓库里存了一堆口令重复生成，一个个人名片无数口令」 | 每次分享都新建 manifest + 新分享链接 | 发布去重 + **稳定分享位**：内容没变复用旧短码；名片/组织就地覆盖同一个目录 |
| 「还一个都识别不了」 | ① 用户跑的是 10-11 安装包，缺 `seafile_share_read` 命令（10-18 才注册）；② 「导入口令」只认 ONV1/ONV2；③ 重复收名片被通讯录去重误报成失败 | ① 需 dev 应用/重打包；② 统一接收入口按类型分发；③ 明确回报「本地已有」 |
| 「名片更新的时候考虑到了吗」 | 旧设计每次更新=新口令+新目录，旧口令指向旧内容 | 稳定分享位：口令不变，manifest 就地覆盖，对方读到的永远是最新名片 |
| 「暂存箱那两个小形态也得能直接粘贴口令或者扫码」 | 雷达/抽屉只有复制口令和 NFC | 两个小形态都加「收口令 / 扫码」 |
| 「电脑上却是手机排版」「1256×596 也被判手机」 | `isPhoneViewport` 只看短边 <600，桌面窗压矮即误判 | 改为「宽<600 算手机；高<600 且宽≤960（横屏手机上限）才算手机」 |

## 这一轮改了什么

### 1. 短码编解码（`lib/shortCode.ts`）
20 位十六进制分享凭据 ↔ 16 位 Base32 无损互转，四位分组加 `ON-` 前缀共 22 字符，**长度与内容大小无关**（大头像不再缩图，内容走云盘 manifest）。大小写/空格/连写容错，Crockford 形近字符（O→0、I/L→1）自动纠正；非标准凭据走 `ONX.<token>` 全量保留不截断随机性。目录分享被云盘策略拒绝时退化为分享 `manifest.json` 文件（`/f/` 链接），两种形态都能短写。

### 2. 发布去重与稳定分享位（`state/cloudExchange.ts`）
`publishExchangeCode(code, contentKey, slotName)` 两层机制：内容摘要没变且旧口令仍可匿名读 → 直接复用；名片/组织按 slot 复用同一个云盘目录、就地覆盖 manifest（`vaultCloud.updateExchangeManifest`）——口令不变、内容永远最新，改一次名片也不多一个目录。暂存箱/碰一碰组合是快照语义，只用内容摘要缓存；箱子复用 `lastShareCode`（任何变更都会清掉它，见 `vault.ts`）。

### 3. 统一接收入口（`lib/contentExchange.ts`）
`receiveExchangeCode(text, vaultTarget)` 认所有口令类型：暂存箱（ONV1/ONV2/短码）、名片与碰一碰组合（ONTOUCH1）、组织邀请（ONORG1）。`vaultTarget` 区分两个老入口的行为：`current` = 替换当前箱（导入口令/收碰一碰的老行为），`new` = 收到进新箱、原箱保留（扫码/NFC/雷达/抽屉/直接交换）。导入入口、收碰一碰、扫码、NFC 接收、雷达、抽屉全部走它。

### 4. 小形态可收（`lib/useVaultReceive.ts`）
共用的「收口令 / 扫码」hook：粘贴口令走表单弹窗，扫码走系统选图 + BarcodeDetector。雷达面板（`VaultDropTarget`）与暂存箱抽屉（`VaultSheet`）都挂上，和整页口径一致。

### 5. 平台判定修正（`state/platform.ts`）
`isPhoneViewport()` 从「短边 <600」改为「宽 <600，或高 <600 且宽 ≤960」。前者会把 1256×596 这种压矮的桌面窗判成手机；后者只放横屏手机（844×390 / 932×430）进来。`pnpm platform-test` 补 11 例钉住边界。

## 验证

- `pnpm --filter @onethu/desktop typecheck` ✓、`pnpm guard` 全绿 ✓（含 ui-copy / onegui 棘轮 / css 配平 / 文档纪律）。
- `tools/short-code-test.mjs` — **57** 例（编解码往返、定长 22、大小写/分隔符/形近字符容错、旧前缀不误判、500 抽样无碰撞、链接形态校验）。
- `tools/short-share-browser-test.mjs` — **50** 例，[report.json](report.json)。假云盘上跑**两个独立客户端**：发送方 A 已连接云盘，接收方 B 全新本地状态且完全没有云盘登录（同一 BrowserContext 两个页面，只共享假云盘里的分享内容）。覆盖：短码生成与二维码、箱子没改复用同一口令、名片更新口令不变且读到新内容、组织重复邀请复用、文件分享兜底路径、B 匿名导入（跨独立客户端读取）、导入口令贴上名片短码、重复收名片、大小写/空格容错、旧 ONV1/ONV2/ONTOUCH1/ONORG1、未连接云盘的双层防护、过期、撤销、篡改、垃圾文本、雷达新入口走通。
- 既有五个浏览器测试同步改造并通过：`vault-browser-test`（含长按 400ms 拾取的手时序修正）、`org-browser-test`（11 例，组织已搬到通讯录页）、`namecard-browser-test`（7 例）、`mobile-vault-browser-test`（14 例）、`feedback-round2-browser-test`（67 例口径，大头像改为走 manifest）。

## 明确未完成 / 下一步

1. **真实云盘互传未闭环**：用户此前跑的是 10-11 安装包，缺 `seafile_share_read` 命令。需用 dev 应用（`pnpm tauri dev`）或重新打包后，两台设备/两个账号实测「发送方生成 → 接收方不连云盘匿名读取」。
2. NFC 真实互传仍需两台 NFC 手机（浏览器侧只有桥接夹具）。
3. 云盘里现存 6 个历史 exchange manifest 是旧构建重复上传的产物，随 7 天过期自动清理，不用管。
4. 清小搭技能广场接 OH 技能注册管理，仍是用户明确暂缓的大任务。

截图：[sender-vault-short-code.png](sender-vault-short-code.png)（发送方口令区，22 字符 + 二维码）、[receiver-anonymous-import.png](receiver-anonymous-import.png)（接收方未连云盘，导入口令成功）、[radar-receive-entries.png](radar-receive-entries.png)（雷达新增「收口令 / 扫码」）。
