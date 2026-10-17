# OneGUI · 组件契约

> 写给"加组件的人"与"迁页面的人"，也是护栏的依据。
> `tools/onegui-guard.mjs` 按它检查，`docs/onegui/03-catalog.md` 按它列目录。

# 1. 组件怎么写（库内）

1. 一个组件 = 一个文件（`src/components/<name>.tsx`）+ 可选的一个样式文件（`src/styles/<name>.css`）。
2. 组件必须用基类生成样式：
   ```tsx
   import { one, cx, scopeProps, type OneBase } from "./kit.js";
   const cls = one("btn").variant(variant).size(size).tone(tone).state("loading", loading).toString();
   ```
   **禁止**在组件里手写 `className="xxx yyy"` 拼装或写内联样式。
3. CSS 只允许引用 `--og-*` 语义令牌（`tokens/semantic.css` 与 `tokens/structure.css` 里的名字）。
   - `--og-ref-*` 只有 `tokens/semantic.css` 能用；
   - 字面色值（`#fff`/`rgba(...)`）、字面 px（`12px`）**一律违规**（例外：0、1px 描边、百分比、
     以及 `styles/base.css` 里的滚动条/选中态等浏览器伪元素细节，且要写注释说明）。
4. 组件私有令牌用 `--og-c-<component>-*`（例：`--og-c-card-pad`），其默认值必须指向结构层令牌：
   `--og-c-card-pad: var(--og-card-pad);`。页面可以用 scope 覆盖 `--og-c-*`，但**不能**直接写值。
5. 状态一律走共享状态层：`.og-interactive::after { background: var(--og-hover) }`，
   按下换 `--og-press`，选中用 `--og-selected`。禁止每个组件各写一套 hover 颜色。
6. 焦点环只用 `var(--og-ring)`；禁用只用 `--og-disabled-opacity`。
7. 动效只用 `--og-dur-*` / `--og-ease-*`；只动画 `transform` / `opacity` / `background-color` / `border-color`。
8. 组件必须接受 `scope?: string` 并挂到最外层（`{...scopeProps(scope)}`）。
9. **不许有 style 属性**：组件对外不暴露 `style`。需要动态几何（拖拽位置、进度宽度、白板坐标）
   时用组件的受控 prop（如 `value`/`offset`），内部用 CSS 变量或 transform 表达，并加 `data-og-dynamic` 标记。

# 2. 类名约定（库内）

- 基类：`og-<component>`（`og-btn`、`og-card`、`og-row`）
- 变体：`og-<component>--<variant>`（`og-btn--solid`、`og-card--flat`）
- 尺寸：`og-<component>--sm|lg`（`md` 是基准，不落类）
- 色调：`og-<component>--t-brand|error|…`（`default` 不落类）
- 状态：`is-<state>`（`is-loading`、`is-selected`、`is-open`、`is-disabled`）
- 子元素：`og-<component>-<part>`（`og-row-title`、`og-card-head`）
- 只有 `packages/gui` 内部可以创建 `og-` 开头的 class。应用代码出现 `og-` 前缀 = 违规。

# 3. 页面怎么迁（应用侧）

| 现在 | 换成 |
|---|---|
| `<div className="card">…` | `<Card>…</Card>` |
| `<div className="row row-click">…` | `<Row title={…} sub={…} onClick={…} />` |
| `<button className="btn btn-primary">` | `<Btn variant="solid" tone="brand">` |
| `<input className="field">` | `<Input />` / `<SearchField />` |
| `<span className="chip chip-blue">` | `<Chip tone="info">` |
| 一页里的 `<div className="section-head">` | `<Section title=… />` |
| `style={{ color: … }}` | 删掉：颜色只能由组件与管线决定 |
| 页面私有 CSS 文件 | 删掉：要特殊就 `defineScope()` + `scope="…"` |

迁移时的硬规则：
1. **UX 不变**：事件、键盘、快捷键、长按、拖拽、双击、aria、滚动行为保持原样 —— 换的只是表达层。
2. 一页迁完就删该页对应的旧 CSS（`global.css`/`explorer*.css` 里的块），不留双轨。
3. 页面里出现裸 `<button>`/`<input>`/`<select>`/`<textarea>` 即为违规（除 `<a>` 与内容渲染白名单）。

# 4. 护栏（tools/onegui-guard.mjs）

| 规则 | 判定 |
|---|---|
| G1 应用零样式文件 | `apps/desktop/src/**/*.css` 必须不存在（内容渲染白名单除外） |
| G2 应用零字面样式 | TSX 里不允许 `style={{` 带 `color/background/border/font/padding/margin/box-shadow` |
| G3 应用零裸控件 | 页面/组件里不允许裸 `<button|input|select|textarea` |
| G4 库内零旁路 | `packages/gui/src/**` 里不允许字面色值/px（白名单：`tokens/*.css`、`styles/base.css` 注释豁免、`skins/*.css`） |
| G5 令牌引用存在 | CSS 里引用的 `--og-*` 必须有定义 |
| G6 组件目录 | `src/index.ts` 导出的组件必须各有一次画廊登记（gallery 矩阵覆盖） |

## exp 单源补充（2026-10-17）

- OneGUI CSS 中的颜色字面值只允许出现在 `tokens/reference.css`，包括 semantic / structure / skins / recipes；R9 强制检查。
- 主要动作使用 action 角色，用户主题使用 accent 角色；两者不得互相覆盖。
- scope 将同名角色映射到自身时不生成声明，继承根值；禁止形成 CSS 自引用。
- `recipes/onethu.css` 是库提供的宿主适配接口。应用可使用其中公开的槽位类（例如设备取景框），不得在应用中重新声明其外观。
- 旧 G1/G2/G3 的全零目标仍是迁移终态；当前 R2/R3/R4/R7/R8 为棘轮，不能把“未新增”表述成“全部已归零”。
