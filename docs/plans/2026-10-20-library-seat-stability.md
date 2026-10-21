# 图书馆座位登录与 token 稳定性排查

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


> 最后更新：2026-10-20

## 结论

现有证据不支持“图书馆整站宕机”：检查时，官方首页和馆列表接口均可匿名访问，返回 HTTP 200。不能因此保证对方手机所处网络、WebVPN 通道或个人账号的登录/预约接口全部正常。

当前 `dev3` 确有两个会导致部分设备登录失败的缺陷，已修复并用隔离测试验证。尚未取得对方设备的版本号及脱敏响应，不能把截图中的每一次失败都归因于这两个缺陷；本轮也没有在对方设备上安装或验收新版本。

## 反馈与证据

- 用户自己可以使用，另一位手机用户在“我的预约”遇到 `access_token 获取失败（首页无 token，会话可能已失效）`。
- 对方截图的顶栏仍为“OneTHU / 首页 / 设置”。这提示应核对是否使用旧包，但单凭外观不能确定版本。
- 代码中的请求地址是固定的 `https://seat.lib.tsinghua.edu.cn/home/web/f_second`。
- 旧错误模板紧接 URL 拼上 `）。建议：退出 OneTHU……`。聊天软件或页面自动识别链接时，可以把这些中文标点和正文一并编码到 URL 中。截图里出现 `%EF%BC%89%E3%80%82...` 并不证明 App 请求了这个污染后的地址。新提示不再把抓取地址拼入正文。
- 无 Cookie、无登录地读取[官方首页](https://seat.lib.tsinghua.edu.cn/home/web/f_second)，返回 HTTP 200、约 25 KB HTML，含馆列表和空的 `userid` / `access_token` 字面量。
- 同样匿名读取[馆列表](https://seat.lib.tsinghua.edu.cn/api.php/areas/1/tree/1)，返回 HTTP 200、`status: 1`、`data.list`。这是公开目录，不是登录证明。
- 公开页面里的 `/api.php/check` 是验证码相关响应，不能仅凭名称把它当作会话探针。本轮没有增加对它的调用。

## 已修复

### 匿名目录被误判为已登录

原 `#libAlive()` 只检查馆列表响应是否为含 `list` 的 JSON。匿名访客也符合该条件，因此 CAS 兑付失败仍会被记录为“图书馆会话已建立”；直到读取“我的预约”时再暴露首页无 token。

现改为读取官方首页的明确 token 字面量来判活。确认得到的 token 与 userid 一起缓存，后续读取预约复用这次结果，不额外抓一遍首页。失败保留原有两轮有界恢复，不增加无限重试。

### 已有 ID 会话的确认页被遗漏

`#roamIdTicket()` 原来只认识 302 票据或成功页链接，不认识 `checkSingle` 确认页。确认页处理位于需要内存密码的 `#idLoginProbe()` 中；恢复已有登录态但没有内存密码的设备到不了这一步。

现把确认页处理加入 SSO 快路径，复用原有确认 POST 与票据兑付方法。直连 ID 不可达而回退 WebVPN 时，确认 POST 保持相同通道。无需额外收集密码，不改变预约/取消操作。

### token 解析与诊断

新增纯函数 `parseLibrarySession()`，仅接受明确的 token 字面量/参数，兼容未加引号、单引号、双引号对象字段及 `window.ska` 赋值。删除“在 access_token 后随意找下一对引号”的兜底，避免把 logout 函数或其他 JS 代码当作凭据。

新 token 不携带上一页遗留 userid；诊断只记 token/用户字段是否存在，不记录 token 前缀或 userid。用户提示改为先重试、持续失败再重新登录，不再要求直接退出整个应用。

`LibraryTab` 的五处错误呈现改为渲染时解析应用自产文案，已显示的提示也跟随语言切换。新增三个中英词条，由独立 `docs/i18n/library-seat-seed.json` 纳入生成流程；学校原始错误原因保持原样。

## 验证

`node tools/library-seat-session-test.mjs`：15 个隔离场景通过，前七项为座位系统：

1. 匿名空值、logout JS、外部脚本路径不能成为 token。
2. 支持的对象与赋值形式正确提取配套用户。
3. 没有内存密码、已有 ID 确认页时能读取预约。
4. ID 直连失败后，确认请求保持 WebVPN 通道。
5. 匿名公开目录不能伪装登录成功，失败最多两轮。
6. 延迟生效的会话第二轮恢复，并发预约记录/馆列表共享恢复链。
7. 确认取票失败保持有界错误，不误发密码登录或预约请求。

其余八项覆盖共用 `#roamIdTicket()` 的宿舍、研讨间服务，各自验证 302 票据、成功页锚点、直连确认页、WebVPN 确认页，确保恢复后不额外请求座位系统 token，也不发密码登录或业务写入。

`node --import ./tools/ts-resolve-register.mjs tools/library-seat-i18n-test.mjs` 验证保存中的错误切换中英再切回、旧报错兼容、外部原因原样保留、五处展示接线及三键词典/seed 一致。

`pnpm --filter @onethu/core typecheck`、`pnpm --filter @onethu/desktop typecheck` 均通过。

这些测试调用真实 `InfoClient`，HTTP 边界完全隔离；未使用真实账号、未发起预约、取消或登录，也没有读取用户的 Cookie/Token。

## 后续验收边界

- 对方手机需核对 App 版本及使用网络；本轮源码修复不会自动进入已安装的旧 APK。
- 若新版本仍失败，优先采集脱敏阶段信息：ID 是否返回确认页、确认是否取得票据、WebVPN 兑付是否失败、首页是否仍匿名。不要发送完整首页、Cookie、Token 或带 `ticket` 的跳转链接。
- 保持座位系统 callback / home / book 的 WebVPN 单通道，不能因公网首页可达就把 seat.lib 加入直连白名单；共享记忆与历史提交已记录这种通道分裂曾造成回归。
