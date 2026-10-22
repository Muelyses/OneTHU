# 二级选课课表恢复

日期：2026-10-22。基线：main `8e960842`。

## 问题与原因

二级课程从教务 `portal3rd.do?m=bks_ejkbSearch` 获取，按校历的第一周周一起点展开，再与一级 JSONP 课表合并。

时间轴窗口 effect 捕获了首次渲染的校历。冷启动时，一级课表请求可以先完成，此时 `calendar.data` 仍为空；校历随后更新，旧 effect 的依赖列表却缺少 `firstDay`，因此这次窗口保留一级结果。已缓存校历的设备容易掩盖这一时序问题。

月历列表使用独立的整月请求，原调用链直接显示一级 `getSchedule` 结果，二级合并入口缺失。

二级页面结构异常或落在登录页时，原解析器可返回空数组。系统日历依靠二级读取的成功状态判断完整性，因此需要将此类响应区分为加载失败。

## 修改

- 时间轴监听 `calendar.data.firstDay`，校历到达后重新加载窗口；过时窗口停止提交缓存和页面状态。
- 月历列表接收相同校历起点，使用共用 `appendSecondarySchedule` 合并当前月份的二级课程。
- 合并返回新数组，按课程名、日期与开始时间去重，保留二级来源标识和原始一级快照。
- 解析器识别登录页、未知页面、截断函数和已填充但结构变化的页面；合法空函数仍表示成功空课表。
- 周次范围兼容 `~`，教学日与大节继续使用现有 `parseCellAnchor` 规则。
- 时间轴与列表在二级刷新失败时保留一级结果，提供中英文提示及刷新入口；诊断分别记录 `SECONDARY-WEEK` 和 `SECONDARY-MONTH`。
- 系统日历沿用既有完整学期保护，解析失败使同步进入完整缓存回退或失败保留路径。

## 验证

| 范围 | 结果 |
| --- | --- |
| 二级真实解析函数与共用合并 | 8 项通过：周次、星期、大节、窗口、范围、空表、登录与异常页、去重和输入快照 |
| 锚点规则 | 14 项通过 |
| 系统日历状态回归 | 28 项通过，包含二级失败保护、完整学期缓存及旧缓存隔离 |
| 浏览器真实页面 | 43 项断言通过：完整／极简／实用三种模式，1280 与 390 宽度，延迟校历、时间轴、列表、时段、详情、屏幕宽度 |
| TypeScript | 桌面工程 `tsc --noEmit` 通过 |
| i18n | 中英文各 7555／7555，errors 0；Android 62 个 fallback 一致 |

浏览器采用独立存储、模拟校园响应和真实 React 组件，外部学校网络被阻断。实际校园页面兼容性和各平台安装包通过后续实机检查确认。

浏览器证据目录：`/Volumes/OneTHUBuild/artifacts/secondary-schedule-2026-10-22/`，含六张模式／尺寸截图及 `report.json`。

## 复跑

```sh
node tools/secondary-schedule-test.mjs
node --import ./tools/ts-resolve-register.mjs tools/secondary-anchor-test.mjs
node tools/system-calendar-state-test.mjs
pnpm --filter @onethu/desktop typecheck
pnpm i18n:check
```

浏览器脚本 `tools/secondary-schedule-browser-test.mjs` 读取 `ONETHU_TEST_URL`、`ONETHU_TEST_OUT`。Playwright 安装在独立运行时的环境可通过 `ONETHU_PLAYWRIGHT_PATH` 指定其 `index.mjs`。

应用本地源码包含本次修复；已分发安装包在重新构建后获得对应代码。

## 0.11.1 发布前复审

系统日历学期缓存升级为 `syscal-sem-v4`。新缓存建立在二级页面完整性校验之上，旧 v3 的一级完整／二级缺失结果按原协议保留。二级读取失败时，新同步回退到 v4 完整镜像，或保留系统日历现有内容并报告失败。新增夹具验证旧 v3 半量镜像保持隔离。

三端应用版本统一为 0.11.1；Android versionCode 11006。发布工作流在 macOS 和 Windows 构建前执行二级解析、锚点及系统日历状态检查。
