# 清小搭技能广场 → OH：实包调查与接入方案

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


日期：2026-10-21。状态：探索完成；运行层方案待落地。已修复确认的广场分页错误；没有把技能安装或执行能力伪装为已完成。

## 结论

能接入，但 OH 当前已有 agent 工具循环、校园工具、OneFlow/插件和浏览器工具，但没有标准 Agent Skills 的加载、资源读取与脚本运行层。模型能读懂技能说明，不代表宿主已经有执行它的环境。桌面可逐步补本地运行能力，不要求新建云端后端；Android 应按自身能力提供真实可用的子集。

旧任务见 `2026-10-18-feedback-round2.md` 第 4 节。标准技能包含 SKILL.md 和可选 scripts/references/assets，脚本语言支持取决于宿主；参考 https://agentskills.io/specification 。

## 已核实的学校接口

使用现有认证，仅拉取广场元数据与 6 个 ZIP 作静态检查。动态广场当时有 273 项；不能用 6 个目的性样本推算整体兼容率。下载可能增加学校的下载计数，但没有执行技能、安装依赖、发起对话或发布内容。

| 功能 | 接口 / 参数 |
| --- | --- |
| 分类、统计 | `/api/skill/plaza/categories`、`/overview` |
| 列表 | `/api/skill/plaza/list?currentPage=1&pageSize=10`，另有 category/sort |
| 搜索 | `/api/skill/plaza/search?keyword=…&page=1&pageSize=10` |
| 详情 | `/api/skill/plaza/detail/{id}` |
| ZIP 下载 | `/api/skill/plaza/download/{id}`；使用 token 头鉴权 |

OneTHU 目前只有分类/统计/列表；所谓详情只是显示列表条目，缺真正的详情请求和下载。详情包含版本、更新时间、示例问题等，但没有可靠的运行环境声明。

**实际故障已修复**：旧客户端发送 `pageNum=2`，服务器仍返回第 1 页；换成 `currentPage=2` 返回第 2 页且数据不同。修复后再次通过真实 XiaodaClient 调用验证。未认证时 HTTP 200 中的 code=2002 表示 token 为空，不能仅看 HTTP 状态。

下载不能复用只读 JSON 的 apiGet；现有 `transport.ts` 已支持 body_b64 二进制 Response。导入还需在原生下载处提前限制传输大小，不能等 base64 已塞进 WebView 后才检查。

协议证据来自官网当前资产：
- https://www.xiaoda.tsinghua.edu.cn/assets/index-CQn9xufO.js
- https://www.xiaoda.tsinghua.edu.cn/assets/index-gHF6L1pI.js
- https://www.xiaoda.tsinghua.edu.cn/qingxiaoda/skills/INSTALL_GUIDE.md

静态安装指南描述的 72 个安装型 + 3 个完整包只是它那批交付，不等于当前动态广场 273 项。指南里的静态下载目录实测 404，应走鉴权下载接口。

## 六个真实技能包

归档元数据、SHA-256、文件数量、脚本路径见 `../research/2026-10-21-xiaoda-skill-samples.json`。ZIP 留在外部构建盘 `/Volumes/OneTHUBuild/artifacts/xiaoda-skills/`，不将第三方包整包提交进仓库。

| 样本 | 实际内容/要求 | 对 OH 的意义 |
| --- | --- | --- |
| high-eq-consultant | 提示词与参考案例；Python 辅助组装；导出 Word 可选 python-docx | 先接加载器即可提供核心对话功能；导出能力单独检测 |
| reference-checker | SKILL.md、证据政策、模板、Python 预检脚本 | 读取资料与核查流程可接；完整预检需要 Python 与检索工具 |
| pandoc-image-skill-lite | Python 脚本；Markdown 用标准库；Word 原生公式依赖 latex2mathml；另有可选 OCR/PPTX 依赖 | 不能因简介写“纯标准库”就判为完全零依赖；图片识别还依赖 OH 所选模型的视觉能力 |
| fuxi | Node >=20、iztro 等依赖、多个 mjs 脚本和参考文件 | 必须先执行确定性计算，不能让模型跳过脚本猜结果 |
| travel-outside-tsinghua | Python httpx，完整 agent 回合另需 openai；默认本地 8003 代理与 8002 MCP；包带 pyc | “零 Key”是把 Key 交给另一个服务，并非免配置；该服务本身不在此包中 |
| academic-writer | 只有 metadata.json、README、SKILL.md，指示用 clawhub/npx 再装真正技能 | 是安装入口，不是完整论文工具；必须递归检查实际目标包 |

六包都把 SKILL.md 放在 ZIP 根目录；静态指南则描述外包一层技能目录。导入器必须支持这两种合法结构，并拒绝多个不明确根目录。样本未见路径穿越或符号链接，这不等于完成代码安全审计。

## OH 现有能力与阻断点

真实 Harness 子模块：`plugins/OneTHU-Harness`，调查基线 `925a7ed796b01aa4535e1c261360d08e36411ad1`。

- `core/src/agent.rs:143,343`：固定系统提示词、静态和 MCP 工具；没有技能索引或按需加载。
- `core/src/tools.rs:816` 与 `apps/desktop/src/state/userext.ts`：ext_tool_create 是固定 ns.method 步骤串，不能替代标准技能包。
- 没有通用 shell/Python/Node agent 工具，也没有随安装包带解释器。`build-harness.mjs` 只复制 Rust 可执行文件及 logo。
- geek_eval 是桌面探索浏览器里的页面 JS，不能运行任意本地 Node 脚本。
- Android 是内嵌同一 Rust core；这不赋予它桌面进程或任意运行时能力。
- 现有 MCP 只有 stdio tools/list 和 tools/call，不是 HTTP/SSE 客户端，也不支持 resources/prompts；每次调用冷启动进程。

接外部运行环境前，应先修现成 MCP 的问题：
1. `tools.rs:1587–1594` 剥掉 mcp_ 后又用含 mcp_ 的前缀匹配，正常动态工具路由失败。
2. `mcp.rs:108–117` 在阻塞 read_line 外判断时间，服务器不输出时超时无法生效；缺输出上限和中断传播。
3. 路由修好后，当前动态 MCP 分支会直接调用并提前返回，未经过静态工具确认策略；不能把这种行为继承给自动导入的技能。本轮没有证明恶意工具已在现有路由故障下成功执行。
4. MCP spawn 继承进程环境且没有隔离；“单独工作目录”不是安全沙箱。

以上来自源码审查，尚未在此轮修复或做故障注入测试。

## 建议方案与取舍

选择标准技能包层，保留原始说明与资源；拒绝把所有技能翻译成固定校园操作步骤，因为那会丢失脚本、资源以及适用条件。也不先投入通用云端执行平台，避免增加服务成本和账户维护。

### 第一期：真实可用的轻量技能

- 广场搜索、分类筛选、详情、完整 ZIP 下载；真正的技能库管理（来源、版本、启用/停用、删除）。
- 有界解包：拒绝绝对路径、../、盘符、符号/硬链接、大小写路径碰撞；限制文件数量、展开大小、单文件大小和压缩比；安装到临时目录后原子切换。
- 记录原始来源 id/version/hash 和许可证；安装型包单独标识，不执行其安装指令；保留资源目录的相对结构。
- OH 增加 skills_search、skill_load、skill_read_file。常驻上下文只有已启用技能的名称和简介，正文与参考资料按需读取。
- 技能说明以第三方工具结果/技能上下文提供，不可覆盖系统规则；allowed-tools 等字段不能自行授予权限。
- 每项能力分别表示：已导入、可用功能、缺少环境、需配置、此设备不支持、待确认；未知依赖不能标成就绪。
- 手机可以运行已满足现有模型/工具条件的说明型与校园工具型技能；不能把桌面状态同步后显示为手机也能运行。

### 第二期：桌面可选运行环境

- Python/Node 按需配置成 OneTHU 管理的独立环境；检测版本、依赖及可用工具，不能假设用户安装过开发环境。
- 运行时与每技能依赖分开，固定版本/哈希；先有用户可理解的安装预览，再做一次授权的环境安装，不默默全局 pip/npm install。
- skill_run 使用明确解释器、脚本和参数数组；有任务目录、输入文件引用、可追踪产物、限时/取消、子进程回收、输出限额及最小环境变量。
- 参数数组、工作目录和超时不能阻止恶意 Python/Node 读取系统文件；还需要平台隔离或明确的受信本地执行模型。没有这层之前，不开放任意未审查脚本自动执行。
- 缺脚本环境时允许使用技能明确独立的文本功能，但必须直说缺失功能；不得以模型生成结果冒充脚本运行成功。

### 第三期：安装入口、外部服务与手机重任务

- ClawHub 安装入口只解析明确的来源与目标版本，拉取目标包后重新检测、审查和记录；不照着第三方 Markdown 直接执行 npx latest。
- 对需要本地服务/API/MCP 的技能做明确配置和连通性诊断；无法从包描述推断这些服务已存在。
- 手机重任务可以后来接用户指定的桌面执行端；目前没有这项基础设施，不在首期承诺。不能为了“一键可用”把校园会话或用户文件自动送去未配置的外部服务。

## 验收标准

1. 装入 high-eq-consultant 后，OH 能自动发现并读取真实说明/案例；桌面和 Android 都核对实际工具调用。
2. 装入 pandoc-image-skill-lite 时，说明 Markdown 与 Word 的不同依赖；缺依赖不会虚报生成文件。
3. fuxi 未就绪时明确缺 Node/依赖；就绪后能中断长任务并回收子进程、展示真实输出。
4. travel 的代理未启动时准确报告服务未配置，而非一直转圈或把 localhost 当远端服务。
5. academic-writer 只能显示安装入口，未拉取最终包前不能显示论文技能已就绪。
6. 更新失败保留上一版本；技能卸载后不再出现在模型上下文；切换账号/模式不会意外启用隐藏技能。
7. 有 ZIP 路径/容量攻击、提示注入、输出超限、进程不响应、权限拒绝与跨平台差异的测试；客户端实际点按和 OH 真实运行也需要验收。

## 本轮交付

完成旧记忆、当前源码、官方协议和真实样包调查，记录方案和边界；修复并在线验证列表分页。没有运行第三方脚本、安装依赖或改动现有 OH 工具权限。接入功能尚未上线。

## 2026-10-21 最小环境实施补充（dev3，待统一提交）

用户后续明确要求电脑与手机有轻量环境，重依赖技能直接说明不可运行，并可保存完整目录给电脑 Agent 使用。本轮选用内置 QuickJS，而不是向手机安装 Python/Node。前面的分期方案与验收项仍是后续方向，不能当成本轮已经完成的能力。

### 已实现

- 清小搭技能广场：真实搜索、详情请求、下载并检查；下载在 Rust 限流读取，不把整个 ZIP 塞进 WebView。下载只走固定学校域名与路径、独立 token 头，不发送校园 Cookie，不跟随重定向。
- 技能库：按设备和当前账号分目录保存，导入后明确显示未启用；可启用、停用、删除。包内容变更（SHA-256 改变）必须重新启用；更新失败保留旧版。启用提示明确说明资料会发送给用户选用的模型。
- 能力判断：纯说明/资料可读取；不依赖宿主的同步 JavaScript 可运行。发现 Python、Node、包安装命令、系统脚本/二进制、外部服务或未知文件类型时，整包保守标记为需要电脑 Agent，禁止在 OH 启用。依赖检测是静态启发式判断，不承诺任意 JavaScript 均可执行。
- 实际 OH 工具：`skills_search`、`skill_load`、`skill_read_file`、`skill_compute`、`skill_run`。工具接到真实宿主方法和原生实现；第三方资料是带 `untrusted` 标记的工具结果，不产生额外权限。运行结果只能来自原生 QuickJS；不得把模型臆测当作脚本执行。
- `skill_compute` 是独立的内置纯计算工具。停用技能撤销索引、加载、读取与按技能运行；不会抹除对话历史，也不能撤销模型已知代码在通用纯计算工具中的使用。工具在极简/实用模式不可用，进行中结果也检查模式修订号和账号是否改变。
- 桌面导出：系统目录选择器选位置，在不覆盖现有目录的前提下写出完整 `SKILL.md` 与资源。Android 导出原 ZIP 到系统下载保存入口，可传到电脑解压。两者都不执行第三方安装命令、脚本或联网包管理器。
- 页面使用 OneGUI 的 SectionCard/Row/Modal/Btn/Chip，新增中英文及翻译种子。运行环境检查按钮执行真实计算（2+3+5），不会仅显示硬编码“已就绪”。

### 原生边界

- QuickJS 每次新建环境，限制 2 秒、32 MiB 堆内存、256 KiB 栈；代码/输入 JSON/输出 JSON 各最多 64 KiB。实际使用 interrupt handler 中止死循环，不只是 Promise 超时。
- 不注入宿主函数、模块加载器、进程、环境变量、网络、文件系统、DOM、Node、Python；只接受源代码，不加载第三方 QuickJS 字节码；异步 Promise 结果拒绝。
- ZIP 限制：下载 8 MiB、展开 32 MiB、单文件 4 MiB、512 个条目、压缩比 200 倍（含小文件容差）。读取文本 256 KiB。拒绝绝对/父级/盘符/Windows 特殊路径、大小写冲突、符号链接与非常规 Unix 文件类型；只接受唯一根 SKILL.md 或一层包装根。
- 路径存储与导出继续使用 native_security 的路径约束；私有文件原子写入；安装先暂存再切换，失败回滚。
- `owner` 来自正常宿主前端的当前账号，用于操作分区与防止异步结果串账号；它不是原生认证凭证，不能作为对被攻陷 WebView 的强安全身份边界。QuickJS 是进程内无宿主解释器，也不是 OS 级进程隔离；引擎漏洞仍需随版本维护。

### 验证证据与实际限制

- Rust 包/运行时/原子更新共 10 项测试通过：路径、根目录、符号链接、重复文件、压缩炸弹、容量限制、主函数/表达式真实计算、无宿主/无模块、死循环实际中断、内存/栈/输出/异步限制、每次环境隔离与更新再启用。
- 另外 1 项真实样本测试把已下载的 6 个学校 ZIP 逐个导入原生存储，验证原始 ZIP 字节保留、完整 SKILL.md、全部默认停用并归类 external-agent。**这 6 包当前都不能直接在 OH 完整运行**，包括有可选 Python 的 high-eq；本轮未做其局部能力拆分。
- Harness 工具路由测试通过：5 个工具实际抵达对应宿主接口，参数和结果正确。
- Android `aarch64-linux-android` 原生 `cargo check --lib` 通过。rquickjs 的 Android 绑定使用 NDK sysroot，两个现有 APK 脚本已补对应构建环境。没有生成 APK，也没有完成 Android 真机运行验证；Windows 原生构建尚未在本轮实测。
- 浏览器验收脚本 `tools/xiaoda-skills-browser-test.mjs` 共 28 项通过、0 渲染错误，使用实际 React/OneGUI 控件和隔离原生 IPC 夹具：桌面 1280 中文、触屏手机 390 中文与英文，检查导入不自动启用、OH 索引、模式隔离、重技能禁止启用、导出结果、删除范围、无横向溢出、模态框边界、底部内容滚动可达与运行时错误。原生 ZIP/QuickJS 由 Rust 测试单独验证，不能把这项浏览器验收说成真机或真实云下载验收。
- 截图、浏览器 report.json 与原生/Android 日志位于 `/Volumes/OneTHUBuild/artifacts/xiaoda-skills/`；6 个真实 ZIP 也保留在该目录，不提交第三方包入仓库。
- 完整 App TS 检查由主 agent 统一完成；主 agent 完成最终 i18n handoff 后 7493/7493、errors 0（清除动态冗余旧键）。
- 尚未实现：Python/Node 安装或进程沙箱、外部服务自动配置、远端执行、技能启用状态云同步、Android 真机/Windows 实机验证。前面提到的旧 MCP 路由与超时问题不在本轮接入路径内，仍需另行修复。
