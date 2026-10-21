//! 生成移动端胶水与 allow-* 权限文件（tauri-plugin 标准构建）。
//!
//! 命令清单必须与本 crate src/lib.rs 的 generate_handler! 以及 Kotlin 插件
//! app.onethu.overlay.OnethuOverlayPlugin 的 @Command 方法一一对应：
//! 前两者是 JS 侧可见名（snake_case），Kotlin 侧是同名 camelCase（见 commands.rs）。
fn main() {
    let commands = &[
        "overlay_supported",
        "overlay_has_permission",
        "overlay_request_permission",
        "overlay_show",
        "overlay_hide",
        "overlay_set_mode",
        "overlay_poll_event",
        "overlay_ack_events",
        "overlay_push_ui",
        "overlay_pick_attach",
        "overlay_open_settings",
        "overlay_status",
    ];
    let result = tauri_plugin::Builder::new(commands)
        .android_path("android")
        .try_build();
    if !(cfg!(docsrs) && std::env::var("TARGET").map(|t| t.contains("android")).unwrap_or(false)) {
        result.unwrap();
    }
}
