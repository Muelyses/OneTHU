# 名片自定义卡面（2026-10-19）

> 历史记录 / Historical record：本文保留当时的计划、研究或验收证据，不代表 0.11 当前能力全集。现行说明见 [文档入口](../README.md)；英文入口见 [English overview](../en/index.md)。


用户：「来点花活，可以修改名片卡面图片（可以调整修改上传图片的显示位置大小，存到云盘），
字体根据背景对比度自然变黑/变白」。

## 数据

`state/nameCard.ts`：`PersonalCard.cover?: CardCover`
```ts
{ src: string;        // 压缩后的 JPEG dataURL（随名片口令一起带出去）
  focusX/focusY: 0..1 // 取景焦点
  zoom: 1..2.5
  ink: "light" | "dark" // 自动/手选的字色
  cloud?: { repoId; path; shareUrl? } // 云盘备份位置
  updatedAt }
```
- 保存时 clamp + 源图上限 1.5MB 字符；`contentExchange.personalShareCode` 的 contentKey
  带上 `cover.updatedAt`，改卡面会自动更新稳定分享位的清单（口令不变）。
- 卡面进暂存箱/碰一碰/名片口令时随 payload 带出，接收方不连云盘也能看到。

## 编辑（components/CardCoverEditor.tsx）

选图 → 压缩（≤1600px 长边、JPEG 质量自适应到上限内）→ 预览卡片内拖动取景 + 缩放滑杆 →
字色「自动 / 白字 / 黑字」→ 保存/移除。预览用与「我的名片」相同的 hero 档 540px 上限，
避免弹层宽度不同导致字号看起来不对。

## 自动字色（对比度）

- 按文字实际所在区域加权：品牌行 / 名字带 / 底部联系行；先看名字带与底部：
  任一 < 0.3 → 白字；两处都亮 → 黑字；其余把「白字方案」和「黑字方案」
  各自对背景（含蒙层）的对比度算出来取高者。
- 蒙层：白字方案压暗（顶部 34% → 底部 64%），黑字方案提亮（顶部 34% → 底部 58%）。
- 手动兜底：真实照片亮暗交错时用户可以自己选白/黑。

## 存云盘（lib/cardCover.ts）

上传到 OneTHU 资料库 `/Cards/cover-<时间>.jpg`（`ensureOneThuRepo` + `write_temp_file` +
`seafile_upload`），尽力生成不过期分享链接；名片里记 `cloud` 引用。
换图/移除封面时尽力删旧文件；云盘不可用时本地卡面照常可用，提示「到云盘页确认登录后重试」。

## 踩坑：全局文字自动对比度会抢卡面字色

`lib/textContrast.ts` 会扫描有文本的元素、按「页面底色」不透算出可读字色并写**内联 color**。
它看不到卡面 `<img>`，于是把卡片当浅底、强行写黑字——用户看到「选白字还是黑字」。
修法：有封面的卡加 `data-tx="keep"`（settle/settleIcon 均跳过该子树），
卡面字色 CSS 加 `!important` 压过历史内联色。

## 测试

`tools/namecard-browser-test.mjs` 23 条：白图→黑字、黑图→白字、上亮下暗混合照片→白字、
手选白/黑字预览计算色真正变化、卡面文件进假云盘 `/Cards/`、深色封面走 `is-cover-light`。
`pnpm guard` 全绿。
