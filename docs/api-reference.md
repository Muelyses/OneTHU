# `onethu.*` API 参考

插件能做的一切事都通过 `ctx.onethu.*` 完成。本文档逐命名空间说明：**它对接的是清华
哪个真实系统、能干什么、每个方法收什么返回什么（附真实数据示例）、怎么报错**。

**接口真源**：`apps/desktop/src/plugins/types.ts`（API 面）、`apps/desktop/src/plugins/facade.ts`（门禁实现）。与本文冲突时以代码为准。

**调用方式**：JS 插件 `ctx.onethu.<ns>.<method>(...)`；Rust 插件
`onethu.call { ns, method, args }`（args 按位置传）。

**通用语义**：除 `session.*`、`ui.toast`、`storage.*`、`nav.go` 外均返回 `Promise`；
失败统一 throw。每个方法头标注 **权限**（manifest.permissions 需声明的 key）、
**写**（变更数据）、**写-确认**（对话面板场景强制两段式确认）。

---

## 0. 通用约定（先读）

| 约定 | 内容 |
|---|---|
| 日期/时间 | 一律 `"YYYY-MM-DD"` / `"HH:MM"` 字符串；`dateChoice` 是枚举（0=今天 1=明天）不是日期 |
| 链式对象传递 | `library.list → floors → sections → seats → book` 这类调用链，后一步入参必须是**前一步返回的元素本体**，不要按 id 自行构造 |
| 会话自愈 | 会话失效宿主自动重建重试；重建失败抛 `AuthRequiredError`（message 含「会话未能建立」）——提示用户重新登录，**不要**重试 |
| 权限错误 | `PluginPermissionError`（message 含「未获授权」）——manifest 漏声明，提示用户重装授权 |
| 超时 | 所有请求 45s 兜底，不会无限悬挂 |
| 网络边界 | 清华内网域校外不可达；校内业务一律走 `onethu.*`（宿主处理通道与自愈），`net.fetch` 只用于外部互联网 |

## 0.1 权限总表

| 权限 | 门禁的 API 面 |
|---|---|
| `user:read` | `session.*`、`user.*` |
| `info:read` | `info.*`、`coursex.*` |
| `learn:read` / `learn:write` | `learn.*`（读 / 发帖回帖） |
| `venue:read` / `venue:book` | `venue.*`（查询 / 退订） |
| `xk:read` | `xk.*` |
| `dorm:read` | `dorm.*`、`kongjian.page/my` |
| `kongjian:book` | `kongjian.book/cancel` |
| `cal:read` / `cal:write` | `cal.agenda` / `cal.add/edit/remove` |
| `card:read` | `card.*` |
| `library:read` / `library:book` | 图书馆/研讨间 查询 / 预约取消 |
| `network:read` | `network.*` |
| `mail:read` / `mail:write` | `mail.list/read/search` / `mail.send` |
| `cloud:read` / `cloud:write` | `cloud.repos/list/search/download` / `upload/share` |
| `llm` | `llm.chat`、`llm.provider` |
| `theme` | `theme.*` |
| `exthw:read` / `exthw:refresh` | `exthw.snapshot` / `exthw.refresh` |
| `webview` | `ui.webModal` |
| `nav` / `ui` | `nav.go` / `ui.toast` |
| `storage` | `storage.*`、`settings.get` |
| `net:external` | `net.fetch` |

---

## 1. `session` / `user` — 登录会话与用户身份

**这是什么**：应用当前的清华统一认证会话状态，以及从信息门户拉到的个人基本信息。
所有插件的第一步通常是检查 `session.status() === "ready"` 再干活。

**权限** `user:read`

| 方法 | 返回 | 说明 |
|---|---|---|
| `session.status()` | `"ready" \| "demo" \| "logged-out" \| "connecting" \| "2fa" \| "booting"` | `ready` 才能调业务接口；`2fa` 表示等用户二次认证 |
| `session.username()` | `string \| null` | 学号或自定义用户名 |
| `user.info()` | `BasicUserInfo` | 首次调用触发 info 漫游，需数秒 |

```jsonc
// user.info() 返回示例
{ "name": "张三", "studentId": "2023011234", "gender": "male",
  "department": "计算机科学与技术系", "major": "计算机科学与技术",
  "email": "zhangsan@mails.tsinghua.edu.cn" }
```

## 2. `llm` — 大模型对话

**这是什么**：内置 AI 助手（官方 Harness 插件）的对话能力。插件**不需要自己管 API
Key**：底层自动在「清华 MadModel 免费档（校园网内免登录 DeepSeek）」和「用户自费
API」之间调度——校内自动白嫖免费档，校外自动切自费，两者都不可用时抛带引导的中文
错误。想自己直连外部 LLM 才用 `net.fetch`（见 §16）。

**权限** `llm`

### `llm.chat(input: string): Promise<{ text, model, provider }>`

| 参数 | 类型 | 说明 |
|---|---|---|
| `input` | string | 自然语言输入（会带上 Harness 会话上下文与工具链，能直接查课表/订座位） |

**返回**：`text` 回答文本；`model` 本次实际模型名（如 `DeepSeek-V4-Flash-0731`）；
`provider` 模型源标识。

**错误**：校外且无自费 Key 时 message 为引导文案（连校园网/EasyConnect 或去设置切
自费 API）；预算超限、会话失效同理。

```js
const { text, model } = await ctx.onethu.llm.chat("我明天有什么课？");
// text: "你明天（周三）有 3 节课：08:00 数据结构 …"
// model: "DeepSeek-V4-Flash-0731"
```

### `llm.provider(): Promise<string>`

读当前模型源设置：`"madmodel"`（免费档）/ `"custom"`（自费）。给用户展示用；
改变它请引导用户去 插件页 → OneTHU Harness → 设置（有「模型源」下拉）。

## 3. `theme` — 主题与昼夜外观

**这是什么**：应用的外观系统。主题 = 一组 CSS 变量覆盖（配色/圆角/阴影），不改布局。
`dark: true` 的主题（如内置「凝夜」）激活时原生控件同步转深色。你的插件可以：查询
架上主题、应用主题、**配好昼夜两档并跟随系统深浅色自动切换**。

**权限** `theme`

### `theme.list(): Promise<Array<{ id, name, version, dark }>>`

```jsonc
[ { "id": "onethu.theme.ivory", "name": "象牙 · 默认", "version": "1.0.0", "dark": false },
  { "id": "onethu.theme.night", "name": "凝夜", "version": "1.0.0", "dark": true } ]
```

### `theme.active(): Promise<string | null>`

手动选中的主题 id；`null` = 基础令牌（默认外观）。

### `theme.apply(id: string | null): Promise<void>`

应用某主题（`null` 回默认）。**副作用**：退出昼夜跟随（用户手动选 = 明确固定）。

### `theme.schedule(): Promise<{ followSystem, dayThemeId, nightThemeId, systemDark }>`

昼夜调度状态。`systemDark` 是系统当前是否深色——跟随模式下它决定实际生效的是
`nightThemeId`（深色）还是 `dayThemeId`（浅色）。

### `theme.setFollowSystem(on)` / `theme.setDayNight(dayId, nightId)`

开关跟随；设置日/夜两档（`null` = 基础令牌）。

```js
// "夜里用凝夜，白天用默认"——系统切深色自动变
await ctx.onethu.theme.setDayNight(null, "onethu.theme.night");
await ctx.onethu.theme.setFollowSystem(true);
```

## 4. `exthw` — 外部作业源

**这是什么**：清华课程作业不只在网络学堂——雨课堂（课堂 PPT/习题）、TUOJ（编程 OJ，
AI 版 + 经典版）、Tyche（另有作业系统）各管一摊。`exthw` 把三源的作业聚合成统一
条目（截止时间、是否已交、是否批改、得分），与原生网络学堂作业并存于作业页。
登录方式与各源行为见 [external-homework.md](./external-homework.md)。

**权限** 快照 `exthw:read`；刷新 `exthw:refresh`

### `exthw.snapshot(): Promise<ExtHwSnapshot>`

```jsonc
{
  "items": [
    { "source": "tyche", "course": "程序设计", "title": "作业 3：链表",
      "deadline": "2026-09-25 23:59", "url": "https://…",
      "submitted": true, "graded": true, "score": 100 },
    { "source": "yuketang", "course": "线性代数", "title": "第 2 周练习",
      "deadline": "2026-09-21 08:00", "url": null,
      "submitted": false, "graded": false, "score": null }
  ],
  "errors": { "tuoj": "TUOJ：需要二次认证…" },
  "state": "idle", "lastAt": 1758271200000,
  "configured": true
}
```

- `submitted` 是**真实判定**（逐源查提交状态；查不到保守 false）。
- `graded`/`score` 仅已批改时有效（Tyche/雨课堂提供）。
- `configured === false` 时插件应直接走原生作业逻辑，别消费本快照。

### `exthw.refresh(): Promise<void>`

触发全源刷新。各源有自己的频控与并发去重；TUOJ 会话失效会自动重漫游一次。

## 5. `info` — 信息门户查询

**这是什么**：清华信息门户（info.tsinghua.edu.cn）聚合的业务数据——教务的课表成绩
考试、校历、新闻、空教室，以及资助/发票/助研津贴等生活数据。**查"学校官方记录的
数据"来这里**；学习行为类（交作业、讨论）走 `learn`。

**权限** `info:read`

| 方法 | 收什么 | 返回什么（真实要点） |
|---|---|---|
| `info.schedule(start, end)` | `"YYYY-MM-DD"` 起/止 | `ScheduleEntry[]`：`{ courseName, teacher, date, location, startTime, endTime, weekText, category }`——周次内已展开的具体课次 |
| `info.report()` | — | 成绩单：`{ name, credit, grade, point, semester }` |
| `info.exams()` | — | 考试安排：courseName/date/startTime/endTime/location |
| `info.deadlines()` | — | 门户重要事项倒计时 |
| `info.news(page?)` / `newsDetail(xxid)` / `searchNews(kw, page?)` / `newsSub(page?, subId?)` | 页码从 1 | 新闻列表（name/xxid/date/source）/正文/搜索/订阅聚合流 |
| `info.schoolCalendar()` | — | 学期起止 + 校历节点（开学周、考试周…） |
| `info.classroomList()` / `classroomState(building, week)` | 楼栋 name、周次 | 空教室楼栋树 / 该周各教室占用 |
| `info.invoices(page)` / `bankPayments()` / `graduateIncome(begin, end)` | — | 电子发票 / 银行代扣 / 助研津贴（`graduateIncome` 仅研究生，可能 `null`） |
| `info.dormScore()` / `physicalExam()` / `assessmentList()` | — | 宿舍卫生分 / 体测结论 / 评教完成状态 |

```jsonc
// info.schedule("2026-09-14", "2026-09-20") 单条示例
{ "courseName": "数据结构", "teacher": "李四", "date": "2026-09-16",
  "location": "六教6A215", "startTime": "08:00", "endTime": "09:35",
  "weekText": "第1-16周", "category": "讲授课" }
```

## 6. `coursex` — courseX 课程共享

**这是什么**：courseX 课程共享计划（学生共建的全校开课信息库）——查"某门课/某位
老师历年的开课时间地点"，不需要登录凭据。

**权限** `info:read`

`coursex.semesters()` → `search(q, semester?)` → `detail(id)`；`detail` 可能返回
`{ id, error }`（查无详情）或 `null`。

## 7. `learn` — 网络学堂

**这是什么**：清华网络学堂（web.learn.tsinghua.edu.cn）——课程公告、作业提交、
课件下载、课程讨论区。**读**（作业/通知/文件/讨论区浏览）只需 `learn:read`；
**发帖/回帖**是 `learn:write` **写**操作（对话面板场景强制两段式确认）。

**权限** `learn:read`；写另需 `learn:write`

| 方法 | 说明 |
|---|---|
| `learn.semesters()` → `courses(semesterId?)` | 学期 id 列表 → 课程列表（Homework/Notification 等都按 courseId 关联） |
| `learn.homework(semesterId?)` / `notifications(semesterId?)` | 作业（含截止/提交状态）/课程公告，均附 courseName |
| `learn.files(courseId, semesterId?)` | 课件列表 |
| `learn.bbsBoards(wlkcid)` → `bbsThreads(...)` → `bbsThread(...)` → `bbsPosts(...)` | 讨论区链式浏览：版面 → 帖子列表 → 帖子 → 回复分页 |
| `learn.reply(wlkcid, threadId, content)` | **写** 回帖（纯文本正文） |
| `learn.post(wlkcid, bqid, title, html)` | **写** 发帖（HTML 正文） |

## 8. `cal` — 日程

**这是什么**：应用内日程。有云同步（用户配置了清华邮箱 CalDAV）时写云端——手机
系统日历/其他设备添加同一邮箱即可见；未配置自动落本地。`agenda` 把云端+本地合并
展开成具体时间点。

**权限** 读 `cal:read`；增删改 `cal:write`（**写**）

| 方法 | 说明 |
|---|---|
| `cal.agenda(startYmd?, endYmd?)` | 缺省今天起 14 天；返回 `{ uid, title, date, start, end, allDay, location?, note?, source: "cloud"\|"local" }[]` |
| `cal.add(title, dateYmd, startHm, endHm, opts?)` | `opts: { location?, note?, allDay?, local? }`；返回 `{ uid, where }` |
| `cal.edit(uid, ch)` | 只传要改的字段；location/note 传空串 = 清除 |
| `cal.remove(uid)` | agenda 返回的 uid，自动路由云/本地 |

## 9. `venue` — 体育场馆

**这是什么**：清华体育部场馆中心（羽毛球、游泳、健身房…）。**法规硬边界**：脚本
预订会被封禁 6 个月（体育部 2025-12-03 公告第七条第 12 款），因此宿主**不提供预约
提交接口**——只有查询、看自己的预约、退订、以及拿官方预约页 URL 让用户自己去订。

**权限** 查询 `venue:read`；退订 `venue:book`

| 方法 | 说明 |
|---|---|
| `venue.scenes()` | 场景列表（uuid + 名称） |
| `venue.currentPage({ sceneUuid, reserveDate, classTypeUuid?, siteType? })` | 某日可约场地 |
| `venue.myRecords(page?)` / `venue.cancel(resvUuid)` | 我的预约 / **写** 退订 |
| `venue.jump(sceneUuid)` | 官方预约页 URL（预约动作引导用户去这里完成） |

## 10. `xk` — 选课系统

**这是什么**：清华选课系统（zhjwxk）的只读数据——课程目录、已选课、以及社区
（学生匿名）的课程评价。不含选课提交操作。

**权限** `xk:read`

`xk.search({ kcm?, kch?, teacher?, semester?, page? })`（kcm=课程名 kch=课号）→
`xk.catalog(sem?)` / `xk.selected(sem?)` / `xk.detail(teacherId, code)`；
`xk.reviews(course, teacher?)` 返回社区评价（`{ count, avg, results[] } | null`）。

## 11. `kongjian` — 宿舍公共空间

**这是什么**：紫荆公寓的公共空间预约（琴房、研讨室、活动室…）。查询走 `dorm:read`，
预约/取消是 `kongjian:book` **写**。

`kongjian.page(opts?)`（`{ spaceId?, roomId?, date? }` 空间/房间/场次树）→
`kongjian.book(bookUrl, { name, sid, tel, other })`（bookUrl 来自 page 返回；
联系人信息用本人真实信息）→ `kongjian.my()` / `kongjian.cancel(target)`（**写**）。

## 12. `card` / `dorm` / `network` — 一卡通 / 宿舍电费 / 校园网

**这是什么**：三个高频查询——校园卡结算中心（余额、消费流水）、学生宿舍服务
（电费余额与充值记录）、校园网自助服务（流量用量、在线设备、账户组）。

**权限** `card:read` / `dorm:read` / `network:read`

```jsonc
// card.info()          // network.balance() 摘选
{ "balance": 233.5, "userName": "张三", … }   { "usedBytes": 53687091200, "accountBalance": 30, … }
// dorm.eleRemainder()
{ "remainder": 145.2, "updateTime": "2026-09-19 10:00" }
```

| 方法 | 说明 |
|---|---|
| `card.info()` / `card.transactions(start, end)` | 余额（元）/ 流水（summary/timestamp/amount/balance） |
| `dorm.eleRemainder()` / `elePayRecord()` | 剩余电量（度）/ 充值记录（从未充值返回 `[]`） |
| `network.balance()` / `devices()` / `deviceCount()` / `accountInfo()` | 用量余额 / 在线设备（ip4/mac/loggedAt）/ 账户信息 |

## 13. `library` / `libroom` — 图书馆座位与研讨间

**这是什么**：图书馆座位预约系统（各分馆的楼层-区域-座位树）与研讨间预约系统
（独立系统，需成员拼团）。查询 `library:read`；预约/取消 `library:book` **写**。

**调用链（对象传递，勿按 id 造对象）**：
`library.list()` → `floors(libraryId, dateChoice)` → `sections(floor, dateChoice)` →
`seats(section, dateChoice)` → `book(seat, sectionId, dateChoice)`。

| 方法 | 关键点 |
|---|---|
| `library.list()` | 楼栋 `{ id, zhName }`（如「北馆(李文正馆)」） |
| `floors / sections / seats` | 每层都带 `available/total` 余量；dateChoice：0=今天 1=明天 |
| `library.book(seat, sectionId, dateChoice?)` | 返回 `{ status?, msg? }`，成功看 msg 语义 |
| `library.records()` / `cancel(recordId)` | 我的预约 / **写** 取消 |
| `libroom.list()` / `resources(date, kindId)` | 类型（研讨间/音乐室…）/ 当日可约资源（含 `limit` 人数上限、`maxMinute` 时长上限） |
| `libroom.book(roomRes, start, end, memberAccNos=[])` | start/end `"YYYY-MM-DD HH:00"`；成员 accNo 来自 `fuzzyMember(keyword)` |
| `libroom.records()` / `cancel(uuid)` / `fuzzyMember(keyword)` | 记录 / **写** 取消 / 按姓名学号搜成员 |

> 个别账号报「会话未能建立」= 研讨间系统未初始化，让用户进应用「预约」页手动进一次。

## 14. `mail` / `cloud` — 邮箱与云盘

**这是什么**：清华邮箱（IMAP/Webmail，读信用云同步的客户端专用密码授权）与清华云盘
（Seafile：资料库/目录/上传下载/分享）。

**权限** `mail:read`（读）`mail:write`（**写** 发信）；`cloud:read` / `cloud:write`（**写**）

| 方法 | 说明 |
|---|---|
| `mail.list(folder, limit)` | folder `"INBOX" \| "Sent Items"`；`{ total, mails: [{ uid, subject, from, dateMs, seen }] }` |
| `mail.read(folder, uid)` | 读一封（自动标已读）：subject/from/to/dateMs/text/html |
| `mail.search(folder, query)` / `mail.send(to, cc, subject, body)` | 服务器端搜索 / **写** 发信（多址由应用拆分） |
| `cloud.repos()` → `list(repoId, path)` / `search(repoId, q)` | 资料库 → 目录（name/kind/size/mtime） |
| `cloud.download(repoId, path)` | 下载到 ~/Downloads，返回本地路径 |
| `cloud.upload(repoId, parentDir, localPath, replace)` / `share(repoId, path, expireDays)` | localPath 支持 `~`；expireDays=0 永久 |

## 15. `nav` / `ui` / `storage` / `settings`

| 方法 | 权限 | 说明 |
|---|---|---|
| `nav.go(page, params?)` | `nav` | 跳到应用某页（路由表见 §17） |
| `ui.toast(text)` | `ui` | 底部气泡 3 秒 |
| `ui.webModal(url)` | `webview` | 应用内 WebView 模态开 URL（Android「桌面模式」浏览外站，如雨课堂作业页）；仅 https；桌面端抛错——catch 后降级系统浏览器 |
| `storage.get/set/keys/remove` | `storage` | 插件私有 KV（按插件 id 隔离，JSON 序列化，卸载即清） |
| `settings.get()` | `storage` | 用户在管理页给你 manifest.settings 填的值 `Record<string,string>` |

## 16. `net` — 外部 HTTP

**这是什么**：绕过 WebView CORS 限制的外部网络请求（走 Rust 传输层：无 CORS、可设
任意头、45s 超时、跟随重定向）。**给外部互联网用**（外部 LLM API、天气、RSS…）；
清华内网业务一律走上面的命名空间（它们自带会话与通道处理）。

**权限** `net:external`

```js
// OpenAI 兼容端点直连（注意：应用内已有免配置的 ctx.onethu.llm.chat，优先用那个）
const res = await ctx.onethu.net.fetch(`${base}/v1/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
});
if (!res.ok) throw new Error(`LLM ${res.status}`);
const reply = (await res.json()).choices[0].message.content;
```

Anthropic 兼容端点换 header（`x-api-key` + `anthropic-version`）。

## 17. 页面路由（`nav.go`）

| page | 页面 | 常用 params |
|---|---|---|
| `today` | 今日首页 | — |
| `learn` | 网络学堂 | — |
| `schedule` | 日程（时间轴/列表） | — |
| `info` | 信息聚合 | `infoTab: "report"\|"exams"\|"news"\|"calendar"\|"profile"\|…`；`infoNewsId` 新闻直达 |
| `life` | 生活聚合 | `lifeTab: "dorm"\|"card"\|"washer"\|"invoice"\|"network"\|…` |
| `reserve` | 预约聚合 | `reserveTab: "lib"\|"room"\|"classroom"\|"sports"\|"kongjian"` |
| `zhjwxk` | 选课系统 | — |
| `settings` / `plugins` | 设置 / 插件管理 | — |
| `learn-course` 等子页 | 学堂详情 | `courseId`、`itemId` |
