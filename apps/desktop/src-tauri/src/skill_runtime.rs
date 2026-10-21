//! A fresh, host-free QuickJS runtime for each computation. No module loader,
//! native functions, filesystem, environment, browser or network are installed.
//! Only JavaScript source is accepted; never deserialize third-party bytecode.
use rquickjs::{Context, Runtime, Value};
use serde_json::Value as Json;
use std::time::{Duration, Instant};

const MAX_CODE: usize = 64 * 1024;
const MAX_IO: usize = 64 * 1024;

pub fn compute(code: &str, input: &Json) -> Result<Json, String> {
    compute_with_limit(code, input, Duration::from_secs(2))
}

fn compute_with_limit(code: &str, input: &Json, limit: Duration) -> Result<Json, String> {
    if code.len() > MAX_CODE { return Err("SKILL_CODE_TOO_LARGE".into()); }
    let input = serde_json::to_string(input).map_err(|_| "SKILL_INVALID_INPUT")?;
    if input.len() > MAX_IO { return Err("SKILL_INPUT_TOO_LARGE".into()); }
    let runtime = Runtime::new().map_err(|_| "SKILL_RUNTIME_FAILED")?;
    runtime.set_memory_limit(32 * 1024 * 1024);
    runtime.set_max_stack_size(256 * 1024);
    let deadline = Instant::now() + limit;
    runtime.set_interrupt_handler(Some(Box::new(move || Instant::now() >= deadline)));
    let context = Context::full(&runtime).map_err(|_| "SKILL_RUNTIME_FAILED")?;
    let result = context.with(|ctx| {
        let input_value = ctx.json_parse(input).map_err(|_| "SKILL_INVALID_INPUT")?;
        ctx.globals().set("input", input_value).map_err(|_| "SKILL_RUNTIME_FAILED")?;
        let value = ctx.eval::<Value, _>(code).map_err(|_| "SKILL_SCRIPT_FAILED")?;
        ctx.globals().set("__skill_result", value).map_err(|_| "SKILL_RUNTIME_FAILED")?;
        // A script may expose main(input); ordinary expression scripts may return
        // their final expression. Async work is intentionally outside this runtime.
        let json = ctx.eval::<String, _>(r#"
            (() => {
                const value = typeof main === 'function' ? main(input) : __skill_result;
                if (value && typeof value.then === 'function') throw new Error('async unsupported');
                const json = JSON.stringify(value);
                if (json === undefined || json.length > 65536) throw new Error('invalid output');
                return json;
            })()
        "#).map_err(|_| "SKILL_SCRIPT_FAILED")?;
        if json.len() > MAX_IO { return Err("SKILL_OUTPUT_TOO_LARGE"); }
        serde_json::from_str::<Json>(&json).map_err(|_| "SKILL_INVALID_OUTPUT")
    }).map_err(String::from);
    if Instant::now() >= deadline { return Err("SKILL_TIME_LIMIT".into()); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn uses_real_input_and_computation() {
        assert_eq!(compute("function main(input) { return {sum: input.values.reduce((a,b)=>a+b,0)}; }", &json!({"values":[2,3,5]})).unwrap(), json!({"sum":10}));
        assert_eq!(compute("input.map(x=>x*2)", &json!([1,2,3])).unwrap(), json!([2,4,6]));
    }
    #[test]
    fn no_host_capabilities_or_module_import() {
        let result = compute("[typeof process, typeof require, typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof std, typeof os, typeof Deno, typeof __TAURI_INTERNALS__]", &Json::Null).unwrap();
        assert_eq!(result, json!(["undefined","undefined","undefined","undefined","undefined","undefined","undefined","undefined","undefined"]));
        assert!(compute("import x from 'std'; x.loadFile('/etc/passwd')", &Json::Null).is_err());
        assert!(compute("Function('return process.env')()", &Json::Null).is_err());
    }
    #[test]
    fn infinite_loop_is_actually_interrupted() {
        let now = Instant::now();
        assert_eq!(compute_with_limit("while(true) {}", &Json::Null, Duration::from_millis(30)).unwrap_err(), "SKILL_TIME_LIMIT");
        assert!(now.elapsed() < Duration::from_secs(2));
    }
    #[test]
    fn resource_limits_and_fresh_contexts() {
        assert!(compute("'x'.repeat(100000)", &Json::Null).is_err());
        assert!(compute("function recur(){return recur()} recur()", &Json::Null).is_err());
        assert!(compute("new ArrayBuffer(128*1024*1024)", &Json::Null).is_err());
        assert!(compute("Promise.resolve(42)", &Json::Null).is_err());
        assert_eq!(compute("globalThis.privateValue = 1", &Json::Null).unwrap(), json!(1));
        assert_eq!(compute("typeof privateValue", &Json::Null).unwrap(), json!("undefined"));
    }
}
