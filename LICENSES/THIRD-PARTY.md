# 第三方组件许可

## packages/info-lib（thu-info-lib 移植版）

- 上游：https://github.com/thu-info-community/thu-info-app（`packages/thu-info-lib`）
- 许可：MIT © 2020-present UNIDY2002（全文见下）
- **Vendored 边界提交：`06dc3cf0`（2024-07-10，上游 MIT 期快照）**
- 移植方式：业务逻辑保留上游 MIT 源码；`src/utils/network.ts` 为 OneTHU 自有的
  platformFetch 适配层（Rust 原生传输：cookie 仓 + 重定向跟随，语义对齐 RN/okhttp）。
  标注 `OneTHU 适配` 的段落为 OneTHU 自有实现（含依据服务器现行行为的等价重写，
  如 roam-id 直连、oauth lbredirect 落地），非上游代码文本。
- 上游在边界提交之后已转为 Business Source License 1.1（Additional Use Grant: None；
  Change Date 为各版本首发满四年，Change License: MIT）。OneTHU 分发版**仅包含
  MIT 边界提交的代码与 OneTHU 自有实现**，不包含 BSL 期代码文本。

## 其他

- cheerio / iconv-lite 等 npm 依赖：各自 MIT 许可，随包分发。
- OneTHU 自有代码（apps/desktop、packages/core 等）：见仓库主 LICENSE。

---

MIT License（thu-info-lib，06dc3cf0 边界）

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
