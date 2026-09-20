//! macOS 通知原生链路探针（默认不构建：`cargo build --features notify-probe --bin notify_probe`）。
//!
//! 为什么需要它：通知链路的原生段（授权查询 / 排程 / 回读 / 撤销）此前只能靠「用户点设置页
//! 的按钮」来验，而 UI 交互无法自动化。把探针二进制**放进 OneTHU.app/Contents/MacOS 里跑**，
//! 它就以应用的 bundle 身份访问通知中心（`NSBundle::mainBundle()` 按可执行文件路径认包），
//! 于是整段链路可以在没有 UI 的情况下被真实执行并打印证据。
//!
//! 安全性：探针排的通知在 120 秒后，脚本会在几秒内把它撤销——不会真的弹出来打扰人；
//! 若尚未授权，排程本就不会显示，但「待投递列表里能否读到」本身就是有效的链路证据。
//!
//! 用法（在仓库内执行）：
//!   cargo build --features notify-probe --bin notify_probe
//!   cp target/.../notify_probe "/Applications/OneTHU.app/Contents/MacOS/"（或 dev 壳）
//!   "/Applications/OneTHU.app/Contents/MacOS/notify_probe"

fn main() {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    println!("== OneTHU 通知原生链路探针 ==");
    println!("可执行文件: {:?}", std::env::current_exe().ok());

    // ① 授权状态（不弹框）
    match onethu_lib::notify_probe_hooks::status(false) {
        Ok(granted) => println!("[1] 授权状态查询: OK（已授权 = {granted}）"),
        Err(e) => {
            println!("[1] 授权状态查询: 失败 —— {e}");
            println!("    若为 not-bundled，说明本二进制没在 .app 包内运行");
            return;
        }
    }

    // ② 排一条 120 秒后的探针
    let id = "probe:notify-doctor";
    let at = now + 120_000;
    match onethu_lib::notify_probe_hooks::add(id, at, "OneTHU 链路探针", "这条会被立即撤销", "settings") {
        Ok(()) => println!("[2] 排程写入: OK（{id}）"),
        Err(e) => println!("[2] 排程写入: 失败 —— {e}"),
    }

    // ③ 回读系统待投递列表
    match onethu_lib::notify_probe_hooks::pending_ids() {
        Ok(ids) => {
            let hit = ids.iter().any(|x| x == id);
            println!("[3] 待投递回读: OK（共 {} 条，含探针 = {hit}）", ids.len());
            if !hit {
                println!("    未见到探针：可能被系统限流，或该 id 已到点投递");
            }
        }
        Err(e) => println!("[3] 待投递回读: 失败 —— {e}"),
    }

    // ④ 撤销探针（不留垃圾通知）
    onethu_lib::notify_probe_hooks::cancel(&[id.to_string()]);
    match onethu_lib::notify_probe_hooks::pending_ids() {
        Ok(ids) => println!("[4] 撤销探针: OK（撤销后剩 {} 条）", ids.len()),
        Err(e) => println!("[4] 撤销探针: 回读失败 —— {e}"),
    }

    println!("== 探针结束 ==");
}
