# OneGUI · 从零重建统一 UI 体系（总纲）

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


> 2026-10-14 立项。用户定案：**整套 UI 完全重写**；**全新中性基准**，玻璃降为 OneGUI 内的一档皮肤（skin）；
> 不做长期双轨。数据层已由 OneTHU SDK（`@onethu/core`）统一，本工程把**样式层**统一到同一种治理方式。
> **UX 不变**：交互、键盘、拖拽、长按、滚动、退场相位保持原样，换的只是表达层。
> 组件目录与迁移台账见 [03-catalog.md](./03-catalog.md)，组件契约见 [10-contract.md](./10-contract.md)。

## 0. 铁律

1. **唯一来源**：全部形状、颜色、间距、字阶、动效、层级只来自 `@onethu/gui`。
   应用代码里不允许出现自己的颜色值、间距、圆角、字号、控件。
2. **意图优先**：组件接收**意图**（`tone` / `level` / `size` / `emphasis` / `density`），不接收样式。
   任何"这次特殊"都必须走**管线通道**（scope），不允许就地写样式。
3. **单一调度**：皮肤、明暗、密度、动效、强调色、平台六个轴由 `StyleDirector` 一处解析、一处落盘。
   组件与页面只能**读**语义令牌，不能算颜色。
4. **一个风格指挥**：皮肤不是"另一套 CSS"，而是对**同一组语义令牌**的另一种取值；换皮肤组件零改动。
5. **护栏即契约**：`tools/onegui-guard.mjs` 是唯一风格裁判（`pnpm guard:onegui`）。换血完成后，
   旧的 40+ 风格护栏由它取代 —— 规则不是删掉，而是搬进库里。
6. **行为不动**：只重写 UI 表达层；`state/`、`lib/`、`plugins/`、`im/`、`memory/`、`@onethu/core`
   的数据流一行不改（除非它自己就是 UI 旁路）。

## 1. 分层

```
packages/gui/                      @onethu/gui —— 唯一 UI 库
  src/tokens/        ① 参考层 + 语义层 + 结构层（唯一色值/尺寸落地处）
  src/pipeline/      ② 风格管线：六轴解析、落盘、scope 通道、订阅（无 React 依赖：director.ts / color.ts）
  src/components/    ③ 组件：kit(基类) / layout / text / surface / button / list / chip / icons /
                        form / overlay / patterns / display / exit(浮层相位)
  src/skins/         ④ 皮肤：neutral（基准）、glass（收编旧玻璃四档）
  src/index.ts       ⑤ 公开 API（唯一 import 面）
  src/gui.css        ⑥ 单一入口样式表（应用只引这一份）
apps/desktop/src/                 只允许消费 OneGUI：零 class、零内联样式、零裸控件
tools/onegui-guard.mjs            唯一风格护栏（六条规则 + 基线棘轮）
docs/onegui/                      本目录：总纲 / 契约 / 目录与台账 / 侦察报告
```

三层令牌：`--og-ref-*`（只有语义层能用）→ `--og-{surface,content,line,accent,status,space,radius,font,size,elev,motion,z}-*`
（组件与模式唯一可用）→ `--og-c-*`（组件私有，页面只能通过 scope 覆盖）。

## 2. 六轴

| 轴 | 取值 | 落盘 |
|---|---|---|
| skin | `neutral`（默认）/ `glass` / 第三方皮肤 | `data-og-skin` |
| skinLevel | `clear` / `base` / `rich` / `deep` | `data-og-skin-level` |
| scheme | `auto` / `light` / `dark` | `data-og-scheme` |
| density | `comfortable` / `compact` / `touch` | `data-og-density` |
| motion | `full` / `reduced` | `data-og-motion` |
| platform | `desktop` / `mobile` | `data-og-platform` |
| accent | 主题对象（一个色）→ 管线算出 soft/line/strong/on/quiet/ring | 内联 `--og-accent*` |

## 3. 特殊要求怎么接入（不许旁路的唯一出口）

1. 通用变体？→ 给组件加枚举 prop。
2. 某页特有？→ `director.defineScope("cloud.fileCard", { "surface-1": "surface-2", radius: "lg" })`，组件写 `scope="cloud.fileCard"`。
3. 新皮肤（玻璃、插件主题）？→ `registerSkin()` 给同一组语义令牌另一套取值。
4. 三者都不许：页面里写 CSS / 内联色值 / 自造 class。

## 4. 迁移与删除清单（换血顺序 = 提交顺序）

1. ✅ `packages/gui` 立项：令牌 + 管线 + 全部组件族 + 画廊 + 护栏（提交 A…）。
   待收台账：660 处内联样式 / 675 处字面色 / 1143 处裸控件（见 03-catalog §3）。
2. ⏳ 壳层换血：`Layout` / `explorer/*`（顶栏、竖栏、标签条、抽屉、设置浮层）。
3. ⏳ 攻坚面：清华云盘（`cloud-*`）、网络学堂（作业/通知/富文本壳）、设置页 + 全部弹层。
4. ⏳ 全量收尾：其余页面逐个迁移，**迁一页删一页旧 CSS**。
5. ⏳ 清场：删 `apps/desktop/src/styles/*`（13k 行）、删 `packages/ui`、旧风格护栏由 `onegui-guard` 取代、
   `design-language.md` 重写为 OneGUI 手册。
6. ⏳ 验收：`pnpm guard` 全绿 + `pnpm typecheck` + 画廊矩阵截图 + 真机走查（亮/暗/皮肤/密度/手机）。

## 5. 验收与证据

- **画廊矩阵**：`?onegui-gallery=1`（可叠 `&skin=glass&level=rich&scheme=dark&density=touch`），
  headless Chrome 截图存档在 `docs/onegui/shots/`。
- **像素证据**：真机/真窗口截图必须先断言窗口 owner（OneTHU ≠ DSH）。
- **护栏**：应用零旁路样式、库内零字面色值/尺寸、令牌引用全部有定义、画廊登记全覆盖。

## 6. 提交规范

`feat(onegui): …` / `refactor(onegui): <页面> 迁到 OneGUI` / `chore(onegui): 删除 <旧 CSS>`。
每一步都提交（AGENTS.md 铁律），不攒工作区。迁移期间应用允许短暂不可用，但 `typecheck` 必须能过。
