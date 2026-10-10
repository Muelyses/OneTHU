//! 生成移动端胶水与 allow-* 权限文件（tauri-plugin 标准构建）。
//!
//! exFAT 仓库专项（与 onethu-speech / onethu-voice 同）：macOS 会为每个写入文件生成
//! ._ AppleDouble 副档，tauri-plugin 的权限扫描会把 ._*.toml 当 TOML 读而 panic
//! （`stream did not contain valid UTF-8`）。构建前递归清掉本插件目录里的 ._ 文件
//! （只清自己，不碰别人的目录）。
fn main() {
    if let Some(dir) = std::env::var_os("CARGO_MANIFEST_DIR") {
        clean_appledouble(std::path::Path::new(&dir));
    }
    let commands = &[
        "tts_supported",
        "tts_prepare",
        "tts_speak",
        "tts_stop",
        "tts_status",
        "tts_voices",
        "tts_set_backend",
    ];
    let result = tauri_plugin::Builder::new(commands)
        .android_path("android")
        .try_build();
    if !(cfg!(docsrs) && std::env::var("TARGET").map(|t| t.contains("android")).unwrap_or(false)) {
        result.unwrap();
    }
}

fn clean_appledouble(dir: &std::path::Path) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                clean_appledouble(&p);
            } else if e.file_name().to_string_lossy().starts_with("._") {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
}
