# 脱敏演示版（OneTHU Demo）构建说明

本分支（`demo`）用于构建**自动化演示用**的脱敏版应用。它与正式版是同一份代码，
只有三处差异。

## 与正式版的差异（全部差异就这三处）

| 位置 | 正式分支 | demo 分支 |
|---|---|---|
| `packages/core/src/privacy/config.ts` | `DESENSITIZE_ENABLED = false` | `DESENSITIZE_ENABLED = true` |
| `apps/desktop/src-tauri/tauri.conf.json` | `identifier = app.onethu.desktop`，`productName = OneTHU` | `identifier = app.onethu.demo`，`productName = OneTHU Demo` |
| 窗口标题 | `OneTHU` | `OneTHU Demo（脱敏演示版）` |

因为应用 id 不同（`app.onethu.demo`），脱敏版与正式版**可以装在同一台机器 / 同一台手机上共存**，
互不覆盖数据。

## 脱敏口径

登录流程**与正式版完全一致**：真实清华统一身份认证 + 2FA，没有任何模拟登录、没有假数据接口。

登录之后，数据在离开客户端的那一刻被替换（`apps/desktop/src/lib/privacy.ts` 用 Proxy 包住
`learn` / `info` / `thu-info-lib helper` / 外部作业源，方法名无需登记，新增接口自动生效）：

| 类别 | 处理 |
|---|---|
| 姓名（自己 / 老师 / 助教 / 讨论区发帖与回复 / 分组同学 / 通知发布人 / 校园卡 / 发票 / 网络账号 / 体育预约 / 体测） | 换成化名池里的化名（张三、李四…），同一个人始终同一个化名 |
| 学号 / 一卡通号 / 账号 | 换成编造学号（保留年级前缀，如 `2025xxxxxx`）；登录凭据本身仍是真实值 |
| 联系方式（邮箱 / 手机 / 座机） | 换成示例邮箱与编造号码 |
| 成绩（成绩单、作业与考试得分、体测总分、雨课堂） | 按 `GRADE_SCALE` 编造，**只出高分段**：A+/A/A- = 4.0（约 2/3）、B+ = 3.6（约 1/3）；等级与绩点取自同一行。**刻意不生成 C/D/F**——真实成绩单里几乎没有人得 1.3 这种绩点，出现即一眼假 |
| 富文本正文（讨论区帖子、通知正文、作业评语、评教建议） | 已登记的真实姓名与 10 位学号一并替换 |
| 非敏感数据（课程名、课表、教室、洗衣机、图书馆座位、新闻、场馆、发票金额…） | **原样不动，全部是真实数据** |

界面标识：侧栏底部角标显示「脱敏演示版」，登录页有一行说明；正式构建里这两处是死代码。

## 构建

```bash
pnpm install
pnpm --filter @onethu/desktop tauri:dev      # 桌面壳开发态（脱敏已生效）
pnpm --filter @onethu/desktop tauri:build    # macOS DMG / Windows EXE（productName = OneTHU Demo）
pnpm --filter @onethu/desktop exec tauri android build --apk --target aarch64
```

**Android 注意**：`apps/desktop/src-tauri/gen/android` 是本地生成物（不入库）。若此前已就正式版
生成过 Android 工程，应用 id 仍是 `app.onethu.desktop`，需要重新生成一次才能拿到
`app.onethu.demo`（否则会覆盖安装正式版）：

```bash
rm -rf apps/desktop/src-tauri/gen/android
pnpm --filter @onethu/desktop exec tauri android init
pnpm --filter @onethu/desktop exec tauri android build --apk --target aarch64
```

签名（自用调试签名，与正式版一致）：

```bash
zipalign -p 4 app-universal-release-unsigned.apk app-demo.apk
apksigner sign --ks ~/.android/debug.keystore --ks-key-alias androiddebugkey \
  --ks-pass pass:android --key-pass pass:android app-demo.apk
adb install -r app-demo.apk
```

## 保留的残余（演示前需知）

1. **登录页输入框**里显示的是你输入的真实学号 / 密码 —— 登录必须用真实凭据，无法脱敏。
   演示前建议清掉「记住密码」并在输入时避开镜头。
2. **未登记的第三方自由文本**（例如某条通知正文里出现了某个姓名，但该姓名此前从未在任何
   结构化字段里出现过）无法被替换 —— 替换依赖「先见过这个名字」。
3. 讨论区 / 通知里由**服务端渲染进 HTML 的姓名**若与结构化 author 字段写法不同（如「王老师」
   vs 「王某某」），以结构化字段为准替换，正文里的变体可能残留。
4. 成绩被编造后，成绩单页的**学分总数 / 平均绩点**由界面按编造值重算，因此与真实数值无关。
5. **宿舍卫生**是服务端渲染的**图片**（曲线图 base64），文本层无法脱敏 —— 该页不显示姓名，
   但演示时若需绝对保守，跳过该页。
6. **体测**只替换姓名、学号与总分，身高 / 体重 / 肺活量等原始测量值保留（不属于姓名 / 学号 / 成绩）。
7. 服务端返回的**图片型数据**（宿舍卫生图、雨课堂题干里的加密字体、附件缩略图）一律按原样展示，
   脱敏层只能处理文本与结构化字段。

## 验证

```bash
node --import ./tools/ts-resolve-register.mjs tools/desensitize-test.mjs   # 69 条断言
cd apps/desktop && npx tsc --noEmit
```

`tools/desensitize-test.mjs` 在两种开关下都成立：正式分支断言「零行为（原样返回同引用）」，
demo 分支断言「必须替换姓名 / 学号 / 嵌套教师名，且原对象不被就地改动」，
并覆盖「非敏感数据零改动」与「成绩等级与绩点同表」。
