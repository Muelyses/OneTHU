# 第三方组件许可

## packages/info-lib（thu-info-lib 移植版）

- 上游：https://github.com/thu-info-community/thu-info-app（`packages/thu-info-lib`）
- 上游许可：MIT（≤06dc3cf0）→ Business Source License 1.1（其后；Change Date 各版本
  首发满四年，Change License: MIT）
- **分发授权：作者 UNIDY2002 于 2026-09-17 邮件亲授——非商业用途分发许可，
  有效期十年**（原始邮件请存档于本目录 `AUTHOR-GRANT-2026-09-17.eml`，随仓库保管）
- Vendored 基线：上游 3.17.0（2026-09-16, Release 3.17.0）
- OneTHU 适配层（自有代码，标注 `OneTHU 适配`）：
  - `src/utils/network.ts`：platformFetch 注入——Rust 原生传输（reqwest cookie
    仓 + 原生重定向跟随，语义对齐上游 RN/okhttp）
  - `src/lib/core.ts`：剔除 OpenHarmony `rtn-network-utils` require 块（vite
    无法静态解析）
  - `src/lib/cr.ts`：联合类型闭包收窄修复

## 其他

- cheerio / iconv-lite / sm-crypto 等 npm 依赖：各自 MIT 许可，随包分发。
- OneTHU 自有代码（apps/desktop、packages/core 等）：见仓库主 LICENSE。

---

MIT License（thu-info-lib 历史版本适用）

Copyright (c) 2020-present UNIDY2002

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
