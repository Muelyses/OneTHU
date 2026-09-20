# Windows 通知模块隔离编译检查

在没有 Windows 机器的前提下，验证 `apps/desktop/src-tauri/src/notify_windows.rs`
（WinRT toast + `AddToSchedule` 定时投递 + AUMID 注册表登记）确实能编到 Windows 目标。

```bash
cd tools/win-notify-check
rustup target add x86_64-pc-windows-msvc   # 只需一次
cargo check --target x86_64-pc-windows-msvc
```

## 为什么不直接在主 crate 上 cross-check

主 crate 依赖 `ring`，它需要在目标平台的 C 工具链；macOS 上没有 MSVC 交叉编译器，
`cargo check --target x86_64-pc-windows-msvc` 会停在 `ring` 的构建脚本上，
永远走不到我们自己的代码。本检查器不依赖主 crate，只按原文件路径引入两个通知模块，
因此能在本机完成 API 级验证。

## 反向验证（必做）

改了 `notify_windows.rs` 后，先把任一 API 名故意改错再跑一次：应当报
`error[E0599]: no associated item named ... found for struct ...`。若仍然「通过」，
说明路径没指到真实文件，检查器在骗你。

## 它不能替代什么

- 不能验证运行时行为（AUMID 是否生效、toast 是否真的弹出来、点击是否触发）；
- 需要在 Windows 真机或 CI（`release.yml` 的 windows-latest job 会真实构建）上验收。
