# dev2 移植报告：info app 合理管线全面移植（4fe → lib 单管线）

**分支** `dev2`（baseline `4fe0400`）· **日期** 2026-09-16 · **评审依据** `docs/INFOLIB-PIPELINE-REVIEW.md`

## 核心结论

评审的两个根本病根在 dev2 上已移除：

1. **双通道互踢** → 单一会话命名空间。lib 登录链建立的 webvpn 会话经 platformFetch
   逐跳记账回灌共享 `http.jar`；lib 与 OneTHU 自有客户端（learn/info/zhjwxk/venue/card）
   读同一 jar，物理上不可能互踢。
2. **校园网/非校园网分叉** → 拓扑唯一。`WebVPN 即网络`：webvpn.tsinghua.edu.cn
   校内校外皆可达，全部 info/learn 流量恒走包装域（wengine 服务端透明 SSO），
   直连/webvpn 降级舞蹈整体退役（无探测、无模式持久化、无回切）。

## 提交序列（可 bisect）

| 提交 | 内容 |
|---|---|
| `0670c9c` | 评审文档 |
| `2740f0e` | **P1** vendor thu-info-lib MIT 边界快照 06dc3cf0（2FA hooks 全量）+ platformFetch/SM2/totp/指纹 适配 |
| `3e15ba4` | **P2+P3** 登录链统一到 lib（2FA futures 桥接两段式 UI）+ URL 大切换（PUBLIC_DIRECT_HOSTS 删 info/learn，PREFIX 常量换包装域） |
| `2931443` | **P4** 会话平面坍缩：CampusSession 619→91 行，demo 链/era 快照/seedJar 全量退役，自愈统一 libEnsureSession |
| `31f682a`* | **P1b/P5** 验收探针页（设置页一键跑 lib 公开 API 矩阵） |
| `bfa53e3`* | info-lib 产物切 ESM（rollup 互操作） |
| `eb8f18d` | infoAppUrl 最后一处 info 直连退役 |

*以 `git log --oneline` 实际哈希为准。

## 关键设计

- **2FA futures**（`apps/desktop/src/lib/infoLib.ts`）：lib 的同步 hooks
  （twoFactorMethodHook→SEND_CODE→twoFactorAuthHook→VERITY→trustFingerprintHook）
  桥接 OneTHU 两段式 UI（选方式→发码→输码+信任设备）。验证码错误自动重启链
  （内存凭据），无需用户返回重选。
- **指纹连续**：SAVE_FINGER 响应 → `helper.fingerGenPrint` → `session.finger3` →
  持久化；登录时回填 `setLibFinger3`。受信设备在 → 静默重登免 2FA（含
  libEnsureSession 内的完整重登）。
- **会话自愈统一入口**：auth-dance 透明重放、InfoClient renewers、10min keepalive
  探针、AuthRequiredError 看门狗、data.ts 去重重建——全部走
  `libEnsureSession()`（探活 → 死则内存凭据完整重登；指数冷却 30s→10min 在调用方）。
- **SM2**：`setSm2Encryptor(encryptPassword)` 注入 @onethu/core 自有实现；登录页
  公钥正则抽取（纯 hex 规则），无加密器时回退明文（= 上游 MIT 边界原行为）。

## 许可合规

vendor = 上游 **06dc3cf0**（2024-07-10 14:53，最后 MIT 提交）`git archive` 提取；
上游 33fd0a86（同日 15:07）起 BSL 1.1 的全部代码（含 9aa65551 SM2 登录）未复制。
所有边界后能力（SM2/totp/指纹/平台传输）来自 OneTHU 既有实现或新增适配层，
改动处以 `OneTHU 适配` 注释标记。见 `packages/info-lib/LICENSE`。

## 验证证据

- `pnpm -r --if-present run typecheck`：**0 错误**（含修复 4fe 预存 rust.ts 错误）
- `pnpm -r --if-present run build`：全包 ✓（desktop vite 5.4s）
- `pnpm test`：28/28 通过（core smoke 5 + xk 解析 23）
- grep 证明：live 路径无 `https://info.tsinghua.edu.cn` / `https://learn.tsinghua.edu.cn`
  字面量（仅退役路径 session/demoLogin/cas 残留——已无调用方）

## 已知风险 / 后续

1. **真机验收未跑**（沙箱无 THU 校园网凭据）：设置页「管线验收」按钮即验收矩阵，
   首次真机登录如出问题按 ✗ 项的 detail 定位（infoLib 每请求有 ILIB 日志行）。
2. **zhjwxk 选课通道未动**（评审定案）：其 id-bounce 凭据来自
   `session.xkCredentials`，凭据注入链已保留（login/resume 后 injectCredentials）。
3. **learn 下载旁路**（Rust download_file/fetch_binary）：已带包装 URL + jar cookie
   + 解码域名合并，理论自洽，真机过一遍文件下载/正文图片。
4. **mail/cloud 等非 info 域**：本就独立凭据（IMAP/Seafile），不在本次范围。
