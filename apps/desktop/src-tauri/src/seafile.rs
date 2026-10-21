//! 清华云盘（Seafile 定制版 @ cloud.tsinghua.edu.cn）—— Web API 直连。
//!
//! 实测（2026-09 无凭据探测）：清华实例保留全套 Seafile Web API，
//! 认证仅需 `Authorization: Token <token>` 头。token 由用户在
//! https://cloud.tsinghua.edu.cn/profile/#get-auth-token 页面生成（一次性）。
//! 参考：thufs（class-undefined/thufs，清华同学的云盘 CLI）。
//!
//! 会话策略：每条命令独立请求（无状态 token，无连接保持）；
//! token 由前端按调用传入（TS 侧 XOR 混淆落 seafile.cfg.json，同 caldav 模式）。

use chrono;
use serde::Serialize;
use serde_json::Value;

const BASE: &str = "https://cloud.tsinghua.edu.cn";

fn client() -> Result<reqwest::Client, String> {
    crate::privacy_consent::require_cloud()?;
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        // 清华域直连：绕系统代理（同 lib.rs download_file，全局模式梯子会触发风控）
        .no_proxy()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())
}

/// 统一错误：把 401/403 翻译成「token 失效」，其余透传状态码与响应体片段
async fn check(resp: reqwest::Response) -> Result<reqwest::Response, String> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let body = resp.text().await.unwrap_or_default();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        // share-links 403 可能是「目录设置了禁分享」——给出可判别信息而非一律说 token 坏
        if body.contains("does not exist") || body.contains("permission") {
            return Err(format!("HTTP {}：{}", status.as_u16(), body.chars().take(160).collect::<String>()));
        }
        return Err("token 无效或已过期，请重新在云盘设置里粘贴".into());
    }
    Err(format!("HTTP {}：{}", status.as_u16(), body.chars().take(160).collect::<String>()))
}

/* ═══════════════ 结构 ═══════════════ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeafileAccount {
    pub name: String,
    pub email: String,
    /// 已用字节
    pub usage: i64,
    /// 总配额字节
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeafileRepo {
    pub id: String,
    pub name: String,
    /// 秒级时间戳（缺省 0）
    pub mtime: i64,
    pub size: i64,
    pub repo_type: String,
    pub owner: String,
    pub owner_name: String,
    pub permission: String,
    pub is_virtual: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeafileEntry {
    pub name: String,
    /// "dir" | "file"
    pub kind: String,
    pub size: i64,
    /// 秒级时间戳
    pub mtime: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeafileShare {
    pub link: String,
    pub token: String,
}

/* ═══════════════ 命令 ═══════════════ */

/// 校验 token：成功即返回账号信息（配置页「连接测试」也走它）
#[tauri::command]
pub async fn seafile_account(token: String) -> Result<SeafileAccount, String> {
    let v: Value = check(client()?.get(format!("{BASE}/api2/account/info/")).bearer_auth(token).send().await.map_err(|e| e.to_string())?)
        .await?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(SeafileAccount {
        name: v.get("name").and_then(|x| x.as_str()).unwrap_or("").into(),
        email: v.get("email").and_then(|x| x.as_str()).unwrap_or("").into(),
        usage: v.get("usage").and_then(|x| x.as_i64()).unwrap_or(0),
        total: v.get("total").and_then(|x| x.as_i64()).unwrap_or(0),
    })
}

/// 资料库列表（含共享给我的库）
#[tauri::command]
pub async fn seafile_repos(token: String) -> Result<Vec<SeafileRepo>, String> {
    // Tsinghua's /api2/repos/ returns type="repo"/"grepo", not "mine".
    // Resolve personal ownership using the authenticated account, never write
    // permission or a familiar library name. Unknown metadata remains unknown.
    let account = seafile_account(token.clone()).await?;
    let v: Vec<Value> = check(client()?.get(format!("{BASE}/api2/repos/")).bearer_auth(token).send().await.map_err(|e| e.to_string())?)
        .await?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(parse_repos(v, &account.email))
}

/// Preserve shared subdirectories: they are real incoming resources even though
/// Seafile calls them virtual libraries. Only the owner's redundant virtual rows
/// are hidden. Prefer the authoritative owned row when a library appears twice.
fn parse_repos(rows: Vec<Value>, account_email: &str) -> Vec<SeafileRepo> {
    let mut output: Vec<SeafileRepo> = Vec::new();
    for row in rows {
        let id = row.get("id").and_then(Value::as_str).unwrap_or("");
        let raw_type = row.get("type").and_then(Value::as_str).unwrap_or("");
        let owner = row.get("owner").and_then(Value::as_str).unwrap_or("");
        let owned = !account_email.is_empty() && owner.eq_ignore_ascii_case(account_email);
        let repo_type = match raw_type {
            "repo" | "mine" if owned => "mine",
            "repo" if !owner.is_empty() && !account_email.is_empty() => "shared",
            "shared" | "srepo" => "shared",
            "group" | "grepo" => "group",
            "org" => "org",
            _ => "",
        };
        let is_virtual = row.get("virtual").and_then(Value::as_bool);
        if id.is_empty() || (is_virtual == Some(true) && repo_type == "mine") { continue; }
        let repo = SeafileRepo {
            id: id.into(),
            name: row.get("name").and_then(Value::as_str).unwrap_or("").into(),
            mtime: row.get("mtime").and_then(Value::as_i64).unwrap_or(0),
            size: row.get("size").and_then(Value::as_i64).unwrap_or(0),
            repo_type: repo_type.into(),
            owner: owner.into(),
            owner_name: row.get("owner_name").and_then(Value::as_str).unwrap_or("").into(),
            permission: row.get("permission").and_then(Value::as_str).unwrap_or("").into(),
            is_virtual,
        };
        if let Some(previous) = output.iter_mut().find(|r| r.id == id) {
            // A direct received share must not be hidden by the same group's row.
            let rank = |kind: &str| match kind { "mine" => 3, "shared" => 2, "group" | "org" => 1, _ => 0 };
            if rank(&repo.repo_type) > rank(&previous.repo_type) { *previous = repo; }
        } else { output.push(repo); }
    }
    output
}

/// 创建资料库（POST /api2/repos/，form: name；同名已存在时 Seafile 会新建重名库——
/// 调用方应先按名字查找，本命令只负责「没有就建」的建侧）。
#[tauri::command]
pub async fn seafile_create_repo(token: String, name: String) -> Result<SeafileRepo, String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("资料库名不能为空".into());
    }
    let v: Value = check(
        client()?
            .post(format!("{BASE}/api2/repos/"))
            .bearer_auth(token)
            .form(&[("name", n)])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;
    let id = v.get("id").or_else(|| v.get("repo_id")).and_then(|x| x.as_str()).unwrap_or("").to_string();
    if id.is_empty() {
        return Err("云盘已接收建库请求但未返回资料库标识，请刷新库列表确认".into());
    }
    Ok(SeafileRepo {
        id,
        name: v.get("name").and_then(|x| x.as_str()).unwrap_or(n).to_string(),
        mtime: v.get("mtime").and_then(|x| x.as_i64()).unwrap_or(0),
        size: v.get("size").and_then(|x| x.as_i64()).unwrap_or(0),
        repo_type: "mine".into(),
        owner: v.get("owner").and_then(Value::as_str).unwrap_or("").into(),
        owner_name: v.get("owner_name").and_then(Value::as_str).unwrap_or("").into(),
        permission: "rw".into(),
        is_virtual: Some(false),
    })
}

/// 目录浏览。path 形如 "/" 或 "/课件/第一周"
#[tauri::command]
pub async fn seafile_dir(token: String, repo_id: String, path: String) -> Result<Vec<SeafileEntry>, String> {
    let p = if path.starts_with('/') { path } else { format!("/{path}") };
    let v: Vec<Value> = check(
        client()?
            .get(format!("{BASE}/api2/repos/{repo_id}/dir/"))
            .bearer_auth(token)
            .query(&[("p", p.as_str())])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;
    let mut out: Vec<SeafileEntry> = v
        .into_iter()
        .map(|e| SeafileEntry {
            name: e.get("name").and_then(|x| x.as_str()).unwrap_or("").into(),
            kind: {
                let t = e.get("type").and_then(|x| x.as_str()).unwrap_or("file");
                if t == "dir" { "dir".into() } else { "file".into() }
            },
            size: e.get("size").and_then(|x| x.as_i64()).unwrap_or(0),
            mtime: e.get("mtime").and_then(|x| x.as_i64()).unwrap_or(0),
        })
        .collect();
    // 目录在前；同类内按 mtime 倒序（最新最上——对齐网页端「最近修改」预期：
    // 刚上传的文件必须出现在可视区顶部，86 条的库字典序会把它埋到 69 行）
    out.sort_by(|a, b| {
        let ka = a.kind != "dir";
        let kb = b.kind != "dir";
        ka.cmp(&kb).then_with(|| b.mtime.cmp(&a.mtime))
    });
    out.dedup_by(|a, b| a.name == b.name);
    Ok(out)
}

/// 下载到设置中的下载目录（Content-Disposition 真名优先；同 lib.rs download_file 约定）
#[tauri::command]
/// `R` 泛型：句柄只在 Android 分支用到（写缓存后经系统桥转存），桌面端实际不使用，
/// 泛型化让 live 测试可以传 mock 句柄而不必构造 Wry 运行时。
pub async fn seafile_download<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    token: String,
    repo_id: String,
    path: String,
) -> Result<String, String> {
    let p = if path.starts_with('/') { path.clone() } else { format!("/{path}") };
    let (bytes, content_disposition) = fetch_file_bytes(&token, &repo_id, &p).await?;
    if bytes.is_empty() {
        return Err("下载失败：文件内容为空".into());
    }
    let name = content_disposition
        .as_deref()
        .and_then(crate::parse_cd_filename)
        .filter(|n| !n.trim().is_empty())
        .or_else(|| path.rsplit('/').next().map(|s| s.to_string()))
        .unwrap_or_else(|| "seafile-file".into());
    let safe_name: String = name.chars().map(|c| if c == '/' || c == ':' { '_' } else { c }).collect();
    // Android：先落应用缓存，再经系统桥转存「系统下载」（MediaStore，用户可见）
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| format!("无法定位缓存目录: {e}"))?
            .join("onethu-dl");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let tmp = dir.join(&safe_name);
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        let handle = app
            .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
            .0
            .clone();
        let r: serde_json::Value = handle
            .run_mobile_plugin(
                "saveDownload",
                serde_json::json!({ "path": tmp.to_string_lossy(), "name": safe_name }),
            )
            .map_err(|e| e.to_string())?;
        if r.get("name").is_some() {
            return Ok(format!("下载/{safe_name}"));
        }
        // 桥失败：缓存文件兜底（至少文件是完整的）
        return Ok(tmp.to_string_lossy().into_owned());
    }
    #[cfg(not(target_os = "android"))]
    {
        let dir = crate::downloads::directory(&app)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(&safe_name);
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    }
}

/// 上传本地文件到云盘（local_path 支持 ~ 前缀展开；replace=true 覆盖同名）
#[tauri::command]
pub async fn seafile_upload(
    token: String,
    repo_id: String,
    parent_dir: String,
    local_path: String,
    replace: bool,
) -> Result<i64, String> {
    let expanded = expand_home(&local_path)?;
    seafile_upload_inner(&token, &repo_id, &parent_dir, std::path::Path::new(&expanded), replace).await
}

async fn seafile_upload_inner(
    token: &str,
    repo_id: &str,
    parent_dir: &str,
    local_path: &std::path::Path,
    replace: bool,
) -> Result<i64, String> {
    let data = std::fs::read(local_path).map_err(|e| format!("读本地文件失败：{e}"))?;
    let filename = local_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "upload.bin".into());
    seafile_upload_data(token, repo_id, parent_dir, filename, data, replace).await
}

/// Small text uploads (especially private share keys) never touch the filesystem.
#[tauri::command]
pub async fn seafile_upload_text(token:String, repo_id:String, parent_dir:String, name:String, content:String)->Result<i64,String>{
    if content.len()>2*1024*1024 || name.is_empty() || name.contains('/') || name.contains('\\') || name==".." {return Err("上传文本或文件名无效".into());}
    seafile_upload_data(&token,&repo_id,&parent_dir,name,content.into_bytes(),true).await
}
/// Private multi-device index; card covers may exceed the generic text limit.
/// Stream from memory, never leave personal contacts in a shared temp directory.
#[tauri::command]
pub async fn seafile_upload_profile(token: String, repo_id: String, name: String, content: String) -> Result<i64, String> {
    if content.len() > 12 * 1024 * 1024 || name.len() < 20 || name.len() > 92 || !name.starts_with("device-") || !name.ends_with(".json")
        || !name[7..name.len()-5].bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("个人资料同步文件无效".into());
    }
    let account = seafile_account(token.clone()).await?;
    let rows = seafile_repos(token.clone()).await?;
    let repo = rows.iter().find(|r| r.id == repo_id).ok_or("个人资料库不可用")?;
    if repo.name != "OneTHU-Profile" || !can_delete_owned_repo(repo, &account.email) {
        return Err("个人资料同步仅限本人完整私有资料库".into());
    }
    seafile_assert_account_acl(token.clone(), repo_id.clone()).await?;
    if !seafile_repo_user_shares(token.clone(), repo_id.clone()).await?.is_empty() {
        return Err("个人资料库已共享，暂停同步".into());
    }
    seafile_upload_data(&token, &repo_id, "/", name, content.into_bytes(), true).await
}
async fn seafile_upload_data(token:&str,repo_id:&str,parent_dir:&str,filename:String,data:Vec<u8>,replace:bool)->Result<i64,String>{
    let pd = if parent_dir.starts_with('/') { parent_dir.to_string() } else { format!("/{parent_dir}") };
    // ① 取 upload-link（返回带引号的裸字符串，trim '"' —— thufs 同款）
    let link: String = check(
        client()?
            .get(format!("{BASE}/api2/repos/{repo_id}/upload-link/"))
            .bearer_auth(token)
            .query(&[("p", pd.as_str())])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .text()
    .await
    .map_err(|e| e.to_string())?;
    let link = link.trim().trim_matches('"').to_string();
    if link.is_empty() {
        return Err("服务器未返回上传链接".into());
    }
    // ② multipart POST（?ret-json=1 拿结构化结果）
    let part = reqwest::multipart::Part::bytes(data)
        .file_name(filename.clone())
        .mime_str("application/octet-stream")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("parent_dir", pd.clone())
        .text("replace", if replace { "1".to_string() } else { "0".to_string() });
    let v: Value = check(
        client()?
            .post(format!("{link}?ret-json=1"))
            .bearer_auth(token)
            .multipart(form)
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;
    // ret-json=1 返回 [{name,id,size}]（size 缺省 -1 表示服务器未回填）
    Ok(v.as_array()
        .and_then(|a| a.first())
        .and_then(|f| f.get("size"))
        .and_then(|x| x.as_i64())
        .unwrap_or(-1))
}

/// 递归建目录（已存在则静默成功）
#[tauri::command]
pub async fn seafile_mkdir(token: String, repo_id: String, path: String) -> Result<(), String> {
    let p = if path.starts_with('/') { path } else { format!("/{path}") };
    check(
        client()?
            .post(format!("{BASE}/api2/repos/{repo_id}/dir/"))
            .bearer_auth(token)
            .query(&[("p", p.as_str())])
            .form(&[("operation", "mkdir"), ("create_parents", "true")])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?;
    Ok(())
}

/// 删除文件或目录（kind="file"|"dir"；目录整棵递归删——UI 层必须 alert 级确认）
#[tauri::command]
pub async fn seafile_delete(
    token: String,
    repo_id: String,
    path: String,
    kind: String,
) -> Result<(), String> {
    let p = if path.starts_with('/') { path } else { format!("/{path}") };
    let seg = if kind == "dir" { "dir" } else { "file" };
    check(
        client()?
            .delete(format!("{BASE}/api2/repos/{repo_id}/{seg}/"))
            .bearer_auth(token)
            .query(&[("p", p.as_str())])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?;
    Ok(())
}

/// 移动/重命名文件或目录（kind="file"|"dir"）：
/// dst_dir 为目标目录（绝对路径）；new_name 非空时同时改名（Seafile rename 语义）
#[tauri::command]
pub async fn seafile_move(
    token: String,
    repo_id: String,
    path: String,
    kind: String,
    dst_repo: String,
    dst_dir: String,
    new_name: String,
) -> Result<(), String> {
    let p = if path.starts_with('/') { path } else { format!("/{path}") };
    let seg = if kind == "dir" { "dir" } else { "file" };
    let dd = if dst_dir.starts_with('/') { dst_dir } else { format!("/{dst_dir}") };
    let mut form: Vec<(&str, String)> = vec![
        ("operation", "move".into()),
        ("dst_repo", dst_repo),
        ("dst_dir", dd),
    ];
    if !new_name.trim().is_empty() {
        form.push(("newname", new_name.trim().to_string()));
    }
    check(
        client()?
            .post(format!("{BASE}/api2/repos/{repo_id}/{seg}/"))
            .bearer_auth(token)
            .query(&[("p", p.as_str())])
            .form(&form)
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?;
    Ok(())
}

/// 生成分享链接（expire_days=0 表示永久；password 可空）
#[tauri::command]
pub async fn seafile_share(
    token: String,
    repo_id: String,
    path: String,
    expire_days: i64,
    password: String,
) -> Result<SeafileShare, String> {
    let p = if path.starts_with('/') { path } else { format!("/{path}") };
    let mut body = serde_json::json!({ "repo_id": repo_id, "path": p });
    if expire_days > 0 {
        body["expire_days"] = serde_json::json!(expire_days);
    }
    if !password.trim().is_empty() {
        body["password"] = serde_json::json!(password.trim());
    }
    let v: Value = check(
        client()?
            .post(format!("{BASE}/api/v2.1/share-links/"))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;
    Ok(SeafileShare {
        link: v.get("link").and_then(|x| x.as_str()).unwrap_or("").into(),
        token: v.get("token").and_then(|x| x.as_str()).unwrap_or("").into(),
    })
}

/// 从分享链接里取出 share token（形如 https://cloud.tsinghua.edu.cn/d/<token>/）。
fn share_token_of(link: &str) -> Option<String> {
    /* 目录分享是 /d/<token>/，单文件分享是 /f/<token>/；两者 token 用法相同。 */
    let i = link.find("/d/").or_else(|| link.find("/f/"))?;
    let rest = &link[i + 3..];
    let tok = rest.split(['/', '?']).next().unwrap_or("").trim();
    if tok.is_empty() { None } else { Some(tok.to_string()) }
}

/// 把文件夹以账号级权限共享给某个云盘用户（双向好友通道）。
/// 实名路径：PUT /api2/repos/{repo_id}/dir/shared_items/?p=/dir，
/// 表单 share_type=user&username=email&permission=rw；实测 owner 会被拒绝，需对方真实账号。
#[tauri::command]
pub async fn seafile_share_folder_to_user(
    token: String,
    repo_id: String,
    path: String,
    email: String,
    permission: String,
) -> Result<(), String> {
    let p = if path.starts_with('/') { path } else { format!("/{path}") };
    let email = email.trim();
    if email.is_empty() || !email.contains('@') {
        return Err("云盘邮箱不合法".into());
    }
    let perm = match permission.trim() {
        "r" | "rw" | "admin" => permission.trim().to_string(),
        _ => "rw".to_string(),
    };
    check(
        client()?
            .put(format!("{BASE}/api2/repos/{repo_id}/dir/shared_items/"))
            .bearer_auth(token)
            .query(&[("p", p.as_str())])
            .form(&[("share_type", "user"), ("username", email), ("permission", perm.as_str())])
            .send()
            .await
            .map_err(|e| e.to_string())?,
    )
    .await?;
    Ok(())
}

/// 删除分享链接（分享生命周期；过期/撤销后的清理入口）。
#[tauri::command]
pub async fn seafile_share_delete(token: String, share_token: String) -> Result<(), String> {
    let t = share_token.trim();
    if t.is_empty() {
        return Err("分享 token 为空".into());
    }
    let response = client()?.delete(format!("{BASE}/api/v2.1/share-links/{t}/")).bearer_auth(token).send().await.map_err(|e|e.to_string())?;
    if response.status() != reqwest::StatusCode::NOT_FOUND { check(response).await?; }
    Ok(())
}

/// 文件分享没有文件夹目录：直接取 /d/<token>/files/?p=/&dl=1 的内容。
async fn read_share_single_file(http: &reqwest::Client, token: &str) -> Result<String, String> {
    let bytes = check(
        http.get(format!("{BASE}/d/{token}/files/"))
            .query(&[("p", "/"), ("dl", "1")])
            .send()
            .await
            .map_err(|e| e.to_string())?,
    )
    .await?
    .bytes()
    .await
    .map_err(|e| e.to_string())?;
    String::from_utf8(bytes.to_vec()).map_err(|_| "分享内容不是 UTF-8 文本（不是清单文件）".to_string())
}

/// 匿名读取一个分享链接根目录下的清单文件（暂存箱口令的接收端通道）。
/// 只读取根目录第一个文件；返回 UTF-8 文本（manifest.json）。
#[tauri::command]
pub async fn seafile_share_read(link: String, name: Option<String>) -> Result<String, String> {
    let token = share_token_of(&link).ok_or_else(|| "不是有效的云盘分享链接（缺少 /d/<token>/）".to_string())?;
    let http = client()?;
    /* 文件夹分享：匿名 dirents；文件分享会返回 400 "not a folder share link"，
       此时按单文件分享直接读 p=/（实测 2026-10-18：清华云盘目录分享可用，
       文件分享只支持 /d/<token>/files/?p=/&dl=1）。 */
    let resp = check(
        http.get(format!("{BASE}/api/v2.1/share-links/{token}/dirents/"))
            .query(&[("path", "/")])
            .send()
            .await
            .map_err(|e| e.to_string())?,
    )
    .await;
    let v: Value = match resp {
        Ok(resp) => resp.json().await.map_err(|e| e.to_string())?,
        Err(e) if e.to_lowercase().contains("not a folder") => {
            return read_share_single_file(&http, &token).await;
        }
        Err(e) => return Err(e),
    };
    /* 实测（2026-10-18）：目录分享的匿名 dirents 返回 {"dirent_list":[{file_name,is_dir,file_path}]}，
       旧代码只看 data/name/type 会找不到文件；同时兼容文件分享可能返回的 data/name/type 形状。 */
    let entries = v
        .get("dirent_list")
        .and_then(|x| x.as_array())
        .or_else(|| v.get("data").and_then(|x| x.as_array()))
        .or_else(|| v.as_array());
    let want = name.unwrap_or_default();
    fn file_name_of(e: &Value) -> Option<&str> {
        e.get("file_name")
            .and_then(|n| n.as_str())
            .or_else(|| e.get("name").and_then(|n| n.as_str()))
    }
    fn is_file(e: &Value) -> bool {
        if let Some(is_dir) = e.get("is_dir").and_then(|d| d.as_bool()) {
            return !is_dir;
        }
        e.get("type").and_then(|t| t.as_str()) == Some("file")
            || e.get("kind").and_then(|t| t.as_str()) == Some("file")
    }
    let name = entries
        .and_then(|a| {
            a.iter().find(|e| {
                let nm = file_name_of(e).unwrap_or("");
                is_file(e) && (want.is_empty() || nm == want)
            })
        })
        .or_else(|| entries.and_then(|a| a.iter().find(|e| is_file(e))))
        .and_then(file_name_of)
        .ok_or_else(|| "分享里没有文件（可能已被撤销或过期）".to_string())?;
    let bytes = check(
        http.get(format!("{BASE}/d/{token}/files/"))
            .query(&[("p", format!("/{name}")), ("dl", "1".to_string())])
            .send()
            .await
            .map_err(|e| e.to_string())?,
    )
    .await?
    .bytes()
    .await
    .map_err(|e| e.to_string())?;
    String::from_utf8(bytes.to_vec()).map_err(|_| "分享清单不是 UTF-8 文本".to_string())
}

/// 库内搜索（seahub 新版：必须带 repo_id；返回 data=[{path,size,mtime(ISO),type}]）
#[tauri::command]
pub async fn seafile_search(token: String, repo_id: String, query: String) -> Result<Vec<SeafileEntry>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let v: Value = check(
        client()?
            .get(format!("{BASE}/api2/search/"))
            .bearer_auth(token)
            .query(&[("repo_id", repo_id.as_str()), ("q", q)])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;
    // seahub master：{data: [...]}；旧版兼容 {results: [...]} / 裸数组
    let arr = v
        .as_array()
        .cloned()
        .or_else(|| v.get("data").and_then(|x| x.as_array()).cloned())
        .or_else(|| v.get("results").and_then(|x| x.as_array()).cloned())
        .unwrap_or_default();
    Ok(arr
        .into_iter()
        .map(|e| {
            let path = e.get("path").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let name = path.rsplit('/').next().unwrap_or("").to_string();
            // mtime：新版 ISO 字符串 → epoch 秒；旧版裸整数
            let mtime = e
                .get("mtime")
                .and_then(|x| x.as_i64())
                .or_else(|| {
                    e.get("mtime")
                        .and_then(|x| x.as_str())
                        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                        .map(|d: chrono::DateTime<chrono::FixedOffset>| d.timestamp())
                })
                .unwrap_or(0);
            SeafileEntry {
                name: if name.is_empty() { e.get("name").and_then(|x| x.as_str()).unwrap_or("").into() } else { name },
                kind: if e.get("type").and_then(|x| x.as_str()) == Some("folder")
                    || e.get("type").and_then(|x| x.as_str()) == Some("dir")
                    || e.get("is_dir").and_then(|x| x.as_bool()).unwrap_or(false)
                {
                    "dir".into()
                } else {
                    "file".into()
                },
                size: e.get("size").and_then(|x| x.as_i64()).unwrap_or(0),
                mtime,
            }
        })
        .collect())
}

/// 系统文件选择器 → 直接上传（字节不过 JS）：多选，逐个传，返回「文件名: 结果」列表
#[tauri::command]
pub async fn seafile_pick_upload(
    app: tauri::AppHandle,
    token: String,
    repo_id: String,
    parent_dir: String,
) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<Vec<tauri_plugin_dialog::FilePath>>>();
    app.dialog().file().pick_files(move |paths| {
        let _ = tx.send(paths);
    });
    let picked = rx.await.map_err(|e| e.to_string())?;
    let Some(paths) = picked else {
        return Ok(Vec::new()); // 用户取消
    };
    let mut out = Vec::new();
    for p in paths {
        let real = match p.into_path() {
            Ok(r) => r,
            Err(e) => {
                out.push(format!("跳过（路径解析失败）：{e}"));
                continue;
            }
        };
        let name = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        match seafile_upload_inner(&token, &repo_id, &parent_dir, &real, true).await {
            Ok(_) => out.push(format!("{name} ✓")),
            Err(e) => out.push(format!("{name} ✗ {e}")),
        }
    }
    Ok(out)
}

/* ═══════════════ 记忆/Files Hub 扩展原语（2026-10 memory-cloud 设计落地） ═══════════════
 *
 * 与既有命令的关系（docs/memory-cloud/01-memory-system.md §4 API 三档）：
 * - seafile_read_bytes     seafile_download 的「到内存」变体（base64 返回），带大小防线；
 * - seafile_update_file    update-link 覆写已存在文件（编辑原语；thufs 同实例验证）；
 * - seafile_uploaded_bytes / seafile_upload_resume  断点续传对
 *   （/file-uploaded-bytes/ + Content-Range 语义，thufs 同实例验证）。
 * 端点均属「thufs 已验证、seafile.rs 未封装」档——正式接入后跑 live 冒烟复核。 */

/// 读文件到内存（base64 返回）。记忆镜像/摘要解析用：不落盘、不弹下载目录。
/// max_bytes ≤0 时取默认 8MB——大课件整个拖进 WebView 会 OOM，这是防线。
#[tauri::command]
pub async fn seafile_read_bytes(
    token: String,
    repo_id: String,
    path: String,
    max_bytes: i64,
) -> Result<String, String> {
    let p = if path.starts_with('/') { path } else { format!("/{path}") };
    let limit = if max_bytes > 0 { max_bytes } else { 8 * 1024 * 1024 };
    let (bytes, _) = fetch_file_bytes(&token, &repo_id, &p).await?;
    if bytes.len() as i64 > limit {
        return Err(format!("文件过大（{} 字节 > 上限 {limit}）：记忆镜像只收小文件，大文件请走 seafile_download", bytes.len()));
    }
    use base64::Engine as _;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// 取文件真字节（download / read_bytes 共用）：GET /api2/repos/<id>/file/?p=…&dl=1。
/// 本实例（thufs 变体）live 实锤（2026-10-10）：dl=1 既不给 302 也不给字节，
/// 而是 200 + **带引号的 seafhttp 下载链接文本**（~126B）。认出它就跟随链接取真字节——
/// 否则 base64/落盘的是 URL 文本：图片预览问号、文本预览显示「文件网址」、下载出 126B 假文件。
async fn fetch_file_bytes(
    token: &str,
    repo_id: &str,
    p: &str,
) -> Result<(Vec<u8>, Option<String>), String> {
    let first = check(
        client()?
            .get(format!("{BASE}/api2/repos/{repo_id}/file/"))
            .bearer_auth(token)
            .query(&[("p", p), ("dl", "1")])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?;
    let content_disposition = first
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let mut bytes = first.bytes().await.map_err(|e| e.to_string())?;
    if bytes.first() == Some(&b'"') && bytes.len() < 2048 {
        let link = String::from_utf8_lossy(&bytes).trim().trim_matches('"').trim().to_string();
        if link.starts_with("http") {
            let second = check(
                client()?
                    .get(&link)
                    .bearer_auth(token)
                    .send()
                    .await.map_err(|e| e.to_string())?,
            )
            .await?;
            bytes = second.bytes().await.map_err(|e| e.to_string())?;
        }
    }
    Ok((bytes.to_vec(), content_disposition))
}

/// 覆写已存在文件（update-link 原语）：GET update-link（指向父目录）→
/// multipart(file, target_file=完整远端路径)。target_file 带 / 开头完整路径（thufs 同款）。
#[tauri::command]
pub async fn seafile_update_file(
    token: String,
    repo_id: String,
    file_path: String,
    local_path: String,
) -> Result<i64, String> {
    let p = if file_path.starts_with('/') { file_path } else { format!("/{file_path}") };
    let (parent, name) = match p.rsplit_once('/') {
        Some((dir, n)) if !n.is_empty() => (if dir.is_empty() { "/".to_string() } else { dir.to_string() }, n.to_string()),
        _ => return Err(format!("路径无文件名：{p}")),
    };
    let expanded = expand_home(&local_path)?;
    let data = std::fs::read(&expanded).map_err(|e| format!("读本地文件失败：{e}"))?;
    // ① 取 update-link（同 upload-link：带引号裸字符串）
    let link: String = check(
        client()?
            .get(format!("{BASE}/api2/repos/{repo_id}/update-link/"))
            .bearer_auth(&token)
            .query(&[("p", parent.as_str())])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .text()
    .await
    .map_err(|e| e.to_string())?;
    let link = link.trim().trim_matches('"').to_string();
    if link.is_empty() {
        return Err("服务器未返回更新链接".into());
    }
    // ② multipart(file, target_file)——注意 target_file 是含目录的完整路径
    let part = reqwest::multipart::Part::bytes(data)
        .file_name(name)
        .mime_str("application/octet-stream")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("target_file", p.clone());
    let v: Value = check(
        client()?
            .post(&link)
            .bearer_auth(token)
            .multipart(form)
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;
    Ok(v.as_array()
        .and_then(|a| a.first())
        .and_then(|f| f.get("size"))
        .and_then(|x| x.as_i64())
        .unwrap_or(-1))
}

/// 断点续传探测：服务器已收字节数（0=无断点。端点报错时如实上抛，由上层决定整传重试）。
#[tauri::command]
pub async fn seafile_uploaded_bytes(
    token: String,
    repo_id: String,
    parent_dir: String,
    file_name: String,
) -> Result<i64, String> {
    let pd = if parent_dir.starts_with('/') { parent_dir } else { format!("/{parent_dir}") };
    let v: Value = check(
        client()?
            .get(format!("{BASE}/api/v2.1/repos/{repo_id}/file-uploaded-bytes/"))
            .bearer_auth(token)
            .query(&[("parent_dir", pd.as_str()), ("file_name", file_name.as_str())])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;
    Ok(v.get("uploadedBytes").and_then(|x| x.as_i64()).unwrap_or(0))
}

/// 断点续传上传：先探测已传字节，再从偏移续传（Content-Range）。
/// replace=true 时跳过续传直接整传（覆盖语义与续传互斥）。
/// TODO（Files Hub 大文件优化）：现整读后切片，>200MB 文件应换流式 Body。
#[tauri::command]
pub async fn seafile_upload_resume(
    token: String,
    repo_id: String,
    parent_dir: String,
    local_path: String,
    replace: bool,
) -> Result<i64, String> {
    let pd = if parent_dir.starts_with('/') { parent_dir } else { format!("/{parent_dir}") };
    let expanded = expand_home(&local_path)?;
    let total = std::fs::metadata(&expanded).map_err(|e| format!("读本地文件失败：{e}"))?.len();
    let filename = std::path::Path::new(&expanded)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "upload.bin".into());
    let start: u64 = if replace {
        0
    } else {
        seafile_uploaded_bytes(token.clone(), repo_id.clone(), pd.clone(), filename.clone())
            .await
            .unwrap_or(0)
            .clamp(0, total as i64) as u64
    };
    let data = std::fs::read(&expanded).map_err(|e| format!("读本地文件失败：{e}"))?;
    // ① upload-link（同 seafile_upload_inner）
    let link: String = check(
        client()?
            .get(format!("{BASE}/api2/repos/{repo_id}/upload-link/"))
            .bearer_auth(&token)
            .query(&[("p", pd.as_str())])
            .send()
            .await.map_err(|e| e.to_string())?,
    )
    .await?
    .text()
    .await
    .map_err(|e| e.to_string())?;
    let link = link.trim().trim_matches('"').to_string();
    if link.is_empty() {
        return Err("服务器未返回上传链接".into());
    }
    // ② 从 start 偏移续传，带 Content-Range（thufs 验证的服务器语义）
    let part = reqwest::multipart::Part::bytes(data[start as usize..].to_vec())
        .file_name(filename.clone())
        .mime_str("application/octet-stream")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("parent_dir", pd.clone())
        .text("replace", if replace { "1".to_string() } else { "0".to_string() });
    let mut req = client()?
        .post(format!("{link}?ret-json=1"))
        .bearer_auth(&token)
        .multipart(form);
    if start > 0 {
        req = req.header("Content-Range", format!("bytes {start}-{}/{total}", total.saturating_sub(1)));
    }
    let v: Value = check(req.send().await.map_err(|e| e.to_string())?)
        .await?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(v.as_array()
        .and_then(|a| a.first())
        .and_then(|f| f.get("size"))
        .and_then(|x| x.as_i64())
        .unwrap_or(-1))
}

/// 本地路径 ~ 前缀展开（seafile_upload 同款逻辑，抽出共用）
fn expand_home(local_path: &str) -> Result<String, String> {
    if let Some(rest) = local_path.strip_prefix("~") {
        let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).map_err(|_| "无法定位主目录")?;
        Ok(format!("{home}{rest}"))
    } else {
        Ok(local_path.to_string())
    }
}

/* ═══════════════ live 测试（真实实例，需 token）═══════════════
 *
 * TSINGHUA_SEAFILE_TOKEN 环境变量注入；`cargo test --lib live -- --ignored --nocapture`
 * 覆盖：账号 → 列库 → 列目录 → 递归建目录 → 上传 → 搜索 → 分享 → 下载校验。
 * 产物落在第一个库的 /onethu-autotest/ 下（留观察，不自动删）。
 */

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn profile_upload_rejects_invalid_names_and_oversize_before_network() {
        for name in ["profile.json", "device-.json", "device-../invalid.json", "device-abcdefgh.json/../leak"] {
            assert!(seafile_upload_profile("unused".into(), "unused".into(), name.into(), "{}".into()).await.is_err());
        }
        assert!(seafile_upload_profile("unused".into(), "unused".into(), "device-abcdefgh.json".into(), "x".repeat(12 * 1024 * 1024 + 1)).await.is_err());
    }

    #[test]
    fn repository_metadata_preserves_incoming_virtual_libraries() {
        let repos = parse_repos(serde_json::json!([
            {"id":"incoming","type":"grepo","virtual":true,"owner":"friend@example.test","permission":"r"},
            {"id":"incoming","type":"shared","virtual":true,"owner":"friend@example.test","owner_name":"Friend","permission":"rw"},
            {"id":"owned-virtual","type":"mine","virtual":true,"owner":"me@example.test"},
            {"id":"duplicate","type":"shared","virtual":false,"owner":"me@example.test","permission":"r"},
            {"id":"duplicate","type":"mine","virtual":false,"owner":"me@example.test","permission":"rw"}
        ]).as_array().unwrap().clone(), "me@example.test");
        assert_eq!(repos.len(), 2);
        assert_eq!(repos[0].is_virtual, Some(true));
        assert_eq!(repos[0].owner, "friend@example.test");
        assert_eq!(repos[0].owner_name, "Friend");
        assert_eq!(repos[1].repo_type, "mine");
        assert_eq!(repos[1].permission, "rw");
        assert!(!can_delete_owned_repo(&repos[0], "friend@example.test"));
        assert!(can_delete_owned_repo(&repos[1], "ME@example.test"));
        assert!(!can_delete_owned_repo(&repos[1], "other@example.test"));
        assert!(!can_delete_owned_repo(&repos[1], ""));
    }

    #[test]
    fn tsinghua_repository_types_use_authenticated_ownership() {
        let repos = parse_repos(serde_json::json!([
            {"id":"memory","name":"OH-Memory","type":"repo","virtual":false,"owner":"ME@example.test","permission":"rw","size":19177},
            {"id":"received","name":"OH-Memory","type":"repo","virtual":false,"owner":"other@example.test","permission":"rw"},
            {"id":"group","type":"grepo","virtual":false,"owner":"me@example.test","permission":"rw"},
            {"id":"missing-owner","type":"repo","virtual":false},
            {"id":"missing-virtual","type":"repo","owner":"me@example.test"},
            {"id":"unknown-type","type":"new-server-type","virtual":false,"owner":"me@example.test"}
        ]).as_array().unwrap().clone(), "me@example.test");
        assert_eq!(repos[0].repo_type, "mine");
        assert!(can_delete_owned_repo(&repos[0], "me@example.test"));
        assert_eq!(repos[1].repo_type, "shared");
        assert!(!can_delete_owned_repo(&repos[1], "me@example.test"));
        assert_eq!(repos[2].repo_type, "group");
        assert!(!can_delete_owned_repo(&repos[2], "me@example.test"));
        assert_eq!(repos[3].repo_type, "");
        assert_eq!(repos[4].is_virtual, None);
        assert!(!can_delete_owned_repo(&repos[4], "me@example.test"));
        assert_eq!(repos[5].repo_type, "");
        assert!(!can_delete_owned_repo(&repos[5], "me@example.test"));
        assert!(repos.iter().all(|r| !can_delete_owned_repo(r, "")));
    }

    fn token() -> String {
        std::env::var("TSINGHUA_SEAFILE_TOKEN").expect("需要 TSINGHUA_SEAFILE_TOKEN 环境变量（云盘 profile 页生成）")
    }

    #[tokio::test]
    #[ignore]
    async fn live_account_and_repos() {
        let acc = seafile_account(token()).await.expect("账号信息");
        println!("账号：{} <{}> 用量 {}/{}", acc.name, acc.email, acc.usage, acc.total);
        assert!(!acc.email.is_empty(), "email 非空");
        assert!(acc.total >= acc.usage, "配额自洽");
        let repos = seafile_repos(token()).await.expect("资料库列表");
        println!("共 {} 个库", repos.len());
        for r in repos.iter().take(5) {
            println!("  - {}（{}）mtime={} size={}", r.name, r.id, r.mtime, r.size);
        }
        assert!(!repos.is_empty(), "至少应有一个库（个人云盘）");
    }

    /// Real single-account boundary smoke. Uses isolated disposable libraries only.
    #[tokio::test]
    #[ignore]
    async fn live_private_share_boundary() {
        let t=token();
        let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let key=seafile_create_repo(t.clone(),format!("OneTHU 私密分享 smoke-key-{stamp}")).await.expect("create private key library");
        let public=match seafile_create_repo(t.clone(),format!("OneTHU 私密分享 smoke-envelope-{stamp}")).await {
            Ok(repo)=>repo,Err(e)=>{seafile_delete_repo(t.clone(),key.id).await.expect("cleanup key");panic!("create envelope library: {e}");}
        };
        let mut share_token=None;
        let result:Result<(),String>=async {
            let owner=seafile_repo_owner(t.clone(),key.id.clone()).await?;
            let account=seafile_account(t.clone()).await?;
            if owner.to_lowercase()!=account.email.to_lowercase(){return Err("repository owner differs from account email; resolve identity mapping before release".into());}
            seafile_assert_account_acl(t.clone(),key.id.clone()).await?;
            if !seafile_repo_user_shares(t.clone(),key.id.clone()).await?.is_empty(){return Err("new private library unexpectedly has grants".into());}
            seafile_upload_text(t.clone(),key.id.clone(),"/".into(),"key.json".into(),r#"{"v":1,"key":"disposable-smoke-key"}"#.into()).await?;
            let bytes=seafile_read_bytes(t.clone(),key.id.clone(),"/key.json".into(),4096).await?;
            if bytes.is_empty(){return Err("owner read returned no bytes".into());}
            let response=client()?.get(format!("{BASE}/api2/repos/{}/file/",key.id)).query(&[("p","/key.json"),("dl","1")]).send().await.map_err(|e|e.to_string())?;
            if response.status().is_success(){return Err("anonymous private key read unexpectedly succeeded".into());}
            let manifest=r#"{"v":1,"kind":"onethu-sealed","data":"disposable-ciphertext-only"}"#;
            seafile_upload_text(t.clone(),public.id.clone(),"/".into(),"manifest.json".into(),manifest.into()).await?;
            let share=seafile_share(t.clone(),public.id.clone(),"/".into(),1,String::new()).await?;
            share_token=Some(share.token.clone());
            if seafile_assert_account_acl(t.clone(),public.id.clone()).await.is_ok(){return Err("public-link bypass was not detected by ACL audit".into());}
            if seafile_share_read(share.link.clone(),None).await?!=manifest{return Err("public envelope read mismatch".into());}
            if seafile_share_read_bytes(share.link,"manifest.json".into(),4096).await?.is_empty(){return Err("bounded share byte endpoint failed".into());}
            seafile_share_delete(t.clone(),share.token.clone()).await?;
            seafile_share_delete(t.clone(),share.token).await?;
            share_token=None;
            Ok(())
        }.await;
        if let Some(st)=share_token {seafile_share_delete(t.clone(),st).await.expect("cleanup public link");}
        seafile_delete_repo(t.clone(),key.id.clone()).await.expect("cleanup key library");
        seafile_delete_repo(t.clone(),key.id).await.expect("idempotent key cleanup");
        seafile_delete_repo(t,public.id).await.expect("cleanup envelope library");
        result.expect("private sharing live boundary");
        println!("PASS: owner identity, ACL read, memory text upload, authenticated key read, anonymous deny, public ciphertext, bounded file read, idempotent cleanup");
    }

    /// Opt-in dual-account entry; no credentials are printed or persisted by this test.
    #[tokio::test]
    #[ignore]
    async fn live_two_account_permissions() {
        let t=token();
        let recipient=std::env::var("TSINGHUA_SEAFILE_RECIPIENT_TOKEN").expect("second test account required");
        let email=seafile_account(recipient.clone()).await.expect("recipient account").email;
        assert_ne!(email,seafile_account(t.clone()).await.expect("owner account").email,"must use distinct accounts");
        let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let repo=seafile_create_repo(t.clone(),format!("OneTHU 私密分享 dual-{stamp}")).await.expect("create disposable library");
        let result:Result<(),String>=async {
            seafile_upload_text(t.clone(),repo.id.clone(),"/".into(),"key.json".into(),"disposable".into()).await?;
            if seafile_read_bytes(recipient.clone(),repo.id.clone(),"/key.json".into(),4096).await.is_ok(){return Err("ungranted recipient can read".into());}
            seafile_set_repo_user_permission(t.clone(),repo.id.clone(),email.clone(),"rw".into()).await?;
            seafile_upload_text(recipient.clone(),repo.id.clone(),"/".into(),"write-check.txt".into(),"write allowed".into()).await?;
            seafile_set_repo_user_permission(t.clone(),repo.id.clone(),email.clone(),"r".into()).await?;
            seafile_read_bytes(recipient.clone(),repo.id.clone(),"/key.json".into(),4096).await?;
            if seafile_upload_text(recipient.clone(),repo.id.clone(),"/".into(),"write-check.txt".into(),"must fail".into()).await.is_ok(){return Err("read-only recipient can write".into());}
            seafile_remove_repo_user_share(t.clone(),repo.id.clone(),email.clone()).await?;
            if seafile_read_bytes(recipient,repo.id.clone(),"/key.json".into(),4096).await.is_ok(){return Err("revoked recipient can read".into());}
            seafile_remove_repo_user_share(t.clone(),repo.id.clone(),email).await?;
            Ok(())
        }.await;
        seafile_delete_repo(t,repo.id).await.expect("cleanup dual-account library");
        result.expect("dual-account grant/downgrade/revoke");
    }

    /// 实测目录分享能被匿名读取；文件分享走 direct fallback 也能读。
    #[tokio::test]
    #[ignore]
    async fn live_share_read_dir_and_file() {
        let t = token();
        let repos = seafile_repos(t.clone()).await.expect("列库");
        let repo = repos.iter().find(|r| r.name == "OneTHU").expect("需要 OneTHU 库");
        let dir = format!("/onethu-live-share-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs());
        let manifest = r#"{"v":1,"kind":"vault-share","name":"rust live","items":[]}"#;
        let tmp_dir = std::env::temp_dir().join(format!("onethu-manifest-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&tmp_dir).expect("建临时目录");
        let tmp = tmp_dir.join("manifest.json");
        std::fs::write(&tmp, manifest).expect("写临时 manifest");
        let result: Result<(), String> = async {
            seafile_mkdir(t.clone(), repo.id.clone(), dir.clone()).await?;
            seafile_upload(t.clone(), repo.id.clone(), dir.clone(), tmp.to_string_lossy().into_owned(), true).await?;
            let share = seafile_share(t.clone(), repo.id.clone(), dir.clone(), 1, String::new()).await?;
            let read = seafile_share_read(share.link.clone(), Some("manifest.json".into())).await?;
            assert_eq!(read, manifest, "目录分享匿名读取内容不一致");
            seafile_share_delete(t.clone(), share.token.clone()).await?;
            /* 文件分享：dirents 会 400，direct p=/ 兜底应能读 */
            let file_share = seafile_share(t.clone(), repo.id.clone(), format!("{dir}/manifest.json"), 1, String::new()).await?;
            let single = seafile_share_read(file_share.link.clone(), None).await?;
            assert_eq!(single, manifest, "文件分享 direct 兜底内容不一致");
            seafile_share_delete(t.clone(), file_share.token).await?;
            Ok(())
        }.await;
        let _ = std::fs::remove_dir_all(&tmp_dir);
        let cleanup = seafile_delete(t.clone(), repo.id.clone(), dir.clone(), "dir".into()).await;
        cleanup.expect("清理测试目录");
        result.expect("live share read 失败");
    }

    /// 账号级文件夹共享：把 /Vault 分享给 owner 自己应被服务端拒绝，验证命令与 API 接线。
    #[tokio::test]
    #[ignore]
    async fn live_share_folder_to_user_owner_rejected() {
        let t = token();
        let me = seafile_account(t.clone()).await.expect("账号信息").email;
        let repos = seafile_repos(t.clone()).await.expect("列库");
        let repo = repos.iter().find(|r| r.name == "OneTHU").expect("需要 OneTHU 库");
        let err = seafile_share_folder_to_user(
            t.clone(),
            repo.id.clone(),
            "/Vault".into(),
            me,
            "rw".into(),
        )
        .await
        .expect_err("分享给 owner 应失败");
        assert!(
            err.to_lowercase().contains("owner") || err.contains("共享"),
            "未预期的错误：{err}"
        );
    }

    #[tokio::test]
    #[ignore]
    async fn live_dir_walk() {
        let repos = seafile_repos(token()).await.expect("列库");
        let repo = &repos[0];
        let entries = seafile_dir(token(), repo.id.clone(), "/".into()).await.expect("根目录");
        println!("库「{}」根目录 {} 项", repo.name, entries.len());
        for e in entries.iter().take(10) {
            println!("  [{}] {} ({}B, mtime={})", e.kind, e.name, e.size, e.mtime);
        }
        // 排序不变式：目录在前
        let dirs_first = entries
            .iter()
            .skip_while(|e| e.kind == "dir")
            .all(|e| e.kind != "dir");
        assert!(dirs_first, "目录应排在文件前");
    }

    #[tokio::test]
    #[ignore]
    async fn live_mkdir_upload_search_share() {
        let t = token();
        let repos = seafile_repos(t.clone()).await.expect("列库");
        let repo = &repos[0];
        let dir = "/onethu-autotest";
        seafile_mkdir(t.clone(), repo.id.clone(), dir.into()).await.expect("递归建目录");

        // 上传一个已知内容的小文件
        let tmp = std::env::temp_dir().join("onethu-seafile-up.txt");
        std::fs::write(&tmp, format!("OneTHU seafile live test @ {}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs())).unwrap();
        let size = seafile_upload(t.clone(), repo.id.clone(), dir.into(), tmp.to_string_lossy().into_owned(), true)
            .await
            .expect("上传");
        println!("上传完成 size={size}");
        assert!(size < 0 || size > 0, "size 应>0 或服务器未回填(-1)");

        // 目录里应能看到它
        let entries = seafile_dir(t.clone(), repo.id.clone(), dir.into()).await.expect("列 autotest 目录");
        assert!(entries.iter().any(|e| e.name == "onethu-seafile-up.txt"), "上传后应出现在目录里");

        // 搜索应能命中（索引可能延迟，轮询 5×2s）
        let mut found = false;
        for _ in 0..5 {
            let hits = seafile_search(t.clone(), repo.id.clone(), "onethu-seafile-up".into()).await.expect("搜索");
            if hits.iter().any(|e| e.name.contains("onethu-seafile-up")) {
                found = true;
                println!("搜索命中：{} 条", hits.len());
                break;
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        println!("搜索命中情况：{}", found);

        // 分享链接
        let share = seafile_share(t.clone(), repo.id.clone(), format!("{dir}/onethu-seafile-up.txt"), 7, String::new())
            .await
            .expect("分享");
        println!("分享链接（7 天）：{}", share.link);
        assert!(share.link.starts_with("https://"), "链接应为 https");

        // 下载回来校验内容
        // seafile_download 后来多了 AppHandle（Android 要写进应用沙盒）：ignored 的 live
        // 测试因此编不过，连累整个 lib 测试目标——这里补上 mock 句柄，测试本身不跑。
        let local = seafile_download(
            tauri::test::mock_app().handle().clone(),
            t.clone(),
            repo.id.clone(),
            format!("{dir}/onethu-seafile-up.txt"),
        )
            .await
            .expect("下载");
        let content = std::fs::read_to_string(&local).unwrap();
        assert!(content.starts_with("OneTHU seafile live test"), "下载内容应为上传原文");
        println!("下载回读校验通过：{local}");
    }
}

/// Server account grants. Do not infer successful authorization from a local roster.
#[derive(Debug, Clone, Serialize)]
pub struct SeafileUserGrant { pub email: String, pub permission: String }

#[tauri::command]
pub async fn seafile_repo_owner(token: String, repo_id: String) -> Result<String, String> {
    // The detail endpoint's owner is a display name on the deployed Seafile 11.
    // The authenticated repository list carries the actual account identifier.
    let repos: Vec<Value> = check(client()?.get(format!("{BASE}/api2/repos/")).bearer_auth(token).send().await.map_err(|e| e.to_string())?).await?.json().await.map_err(|e| e.to_string())?;
    repos.iter().find(|r| r.get("id").and_then(Value::as_str)==Some(repo_id.as_str()))
        .and_then(|r|r.get("owner")).and_then(Value::as_str).filter(|s|s.contains('@')).map(str::to_owned)
        .ok_or_else(|| "云盘没有返回资料库所有者账号，无法安全修改权限".into())
}

#[tauri::command]
pub async fn seafile_repo_user_shares(token: String, repo_id: String) -> Result<Vec<SeafileUserGrant>, String> {
    let v: Value = check(client()?.get(format!("{BASE}/api2/repos/{repo_id}/dir/shared_items/")).bearer_auth(token).query(&[("p", "/"), ("share_type", "user")]).send().await.map_err(|e| e.to_string())?).await?.json().await.map_err(|e| e.to_string())?;
    let rows = v.as_array().ok_or("云盘返回的权限列表格式不正确")?;
    rows.iter().map(|r| {
        let email = r.pointer("/user_info/name").or_else(|| r.get("username")).or_else(|| r.get("email")).and_then(Value::as_str).ok_or("云盘权限记录缺少邮箱")?;
        let permission = r.get("permission").and_then(Value::as_str).ok_or("云盘权限记录缺少角色")?;
        Ok(SeafileUserGrant { email: email.to_lowercase(), permission: permission.into() })
    }).collect()
}

#[tauri::command]
pub async fn seafile_set_repo_user_permission(token: String, repo_id: String, email: String, permission: String) -> Result<(), String> {
    let email = email.trim().to_lowercase();
    if !email.contains('@') || !matches!(permission.as_str(), "r" | "rw") { return Err("邮箱或权限无效".into()); }
    let before = seafile_repo_user_shares(token.clone(), repo_id.clone()).await?;
    if before.iter().any(|r| r.email == email && r.permission == permission) { return Ok(()); }
    let exists = before.iter().any(|r| r.email == email);
    let http = client()?;
    let url = format!("{BASE}/api2/repos/{repo_id}/dir/shared_items/");
    let req = if exists {
        http.post(url).query(&[("p", "/"), ("share_type", "user"), ("username", email.as_str())]).form(&[("permission", permission.as_str())])
    } else {
        http.put(url).query(&[("p", "/")]).form(&[("share_type", "user"), ("username", email.as_str()), ("permission", permission.as_str())])
    };
    check(req.bearer_auth(&token).send().await.map_err(|e| e.to_string())?).await?;
    // PUT can return HTTP 200 with a per-user failure; the authoritative read detects it.
    if !seafile_repo_user_shares(token, repo_id).await?.iter().any(|r| r.email == email && r.permission == permission) { return Err("云盘没有确认权限更新，请重试".into()); }
    Ok(())
}

#[tauri::command]
pub async fn seafile_remove_repo_user_share(token: String, repo_id: String, email: String) -> Result<(), String> {
    let email = email.trim().to_lowercase();
    if !email.contains('@') { return Err("邮箱无效".into()); }
    if !seafile_repo_user_shares(token.clone(), repo_id.clone()).await?.iter().any(|r| r.email == email) { return Ok(()); }
    check(client()?.delete(format!("{BASE}/api2/repos/{repo_id}/dir/shared_items/")).bearer_auth(&token).query(&[("p", "/"), ("share_type", "user"), ("username", email.as_str())]).send().await.map_err(|e| e.to_string())?).await?;
    if seafile_repo_user_shares(token, repo_id).await?.iter().any(|r| r.email == email) { return Err("云盘尚未撤销该成员权限，请重试".into()); }
    Ok(())
}

/// Explicit user deletion; the private-share cleanup command below stays scoped.
/// Recheck ownership against the live server immediately before deletion. A write
/// grant is not ownership, and deleting a received subfolder must never delete the
/// source library belonging to somebody else.
#[tauri::command]
pub async fn seafile_delete_owned_repo(token: String, repo_id: String) -> Result<(), String> {
    if repo_id.len() != 36 || !repo_id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err("资料库标识无效".into());
    }
    let account = seafile_account(token.clone()).await?;
    let repos = seafile_repos(token.clone()).await?;
    let repo = repos.iter().find(|r| r.id == repo_id).ok_or("资料库已不存在或当前账号无权访问，请刷新列表")?;
    if !can_delete_owned_repo(repo, &account.email) { return Err("只有资料库所有者可以删除整个资料库".into()); }
    check(client()?.delete(format!("{BASE}/api2/repos/{repo_id}/")).bearer_auth(token).send().await.map_err(|e| e.to_string())?).await?;
    Ok(())
}

fn can_delete_owned_repo(repo: &SeafileRepo, account_email: &str) -> bool {
    repo.repo_type == "mine" && repo.is_virtual == Some(false) && !account_email.is_empty()
        && repo.owner.eq_ignore_ascii_case(account_email)
}

/// Deletes only a private key library created for OneTHU sharing.
#[tauri::command]
pub async fn seafile_delete_repo(token: String, repo_id: String) -> Result<(), String> {
    let response = client()?.get(format!("{BASE}/api2/repos/{repo_id}/")).bearer_auth(&token).send().await.map_err(|e| e.to_string())?;
    // A previous attempt may have removed the key before link deletion failed.
    // Only an explicit absence is idempotent; authentication errors still fail.
    if response.status() == reqwest::StatusCode::NOT_FOUND { return Ok(()); }
    let v: Value = check(response).await?.json().await.map_err(|e| e.to_string())?;
    if !v.get("name").and_then(Value::as_str).unwrap_or("").starts_with("OneTHU 私密分享 ") { return Err("只允许清理 OneTHU 私密分享资料库".into()); }
    check(client()?.delete(format!("{BASE}/api2/repos/{repo_id}/")).bearer_auth(token).send().await.map_err(|e| e.to_string())?).await?;
    Ok(())
}

/// Public share files are bounded and paths cannot escape the share root.
#[tauri::command]
pub async fn seafile_share_read_bytes(link:String, path:String, max_bytes:i64)->Result<String,String>{
    if path.split('/').any(|s|s=="..") || path.contains('\\') {return Err("分享文件路径无效".into());}
    let token=share_token_of(&link).ok_or("分享链接无效")?;
    let p=format!("/{}",path.trim_start_matches('/'));
    let response=check(client()?.get(format!("{BASE}/d/{token}/files/")).query(&[("p",p),("dl","1".into())]).send().await.map_err(|e|e.to_string())?).await?;
    let limit=max_bytes.clamp(1,180*1024*1024) as usize;
    if response.content_length().unwrap_or(0)>limit as u64{return Err("分享文件超过支持的大小".into());}
    let mut response=response;let mut bytes=Vec::new();
    while let Some(chunk)=response.chunk().await.map_err(|e|e.to_string())?{if bytes.len()+chunk.len()>limit{return Err("分享文件超过支持的大小".into());}bytes.extend_from_slice(&chunk);}
    use base64::Engine as _;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Organization ACL reconciliation cannot override an independent broad or folder grant.
/// Refuse to claim a complete downgrade until the owner has resolved those grants.
#[tauri::command]
pub async fn seafile_assert_account_acl(token:String,repo_id:String)->Result<(),String>{
    let account=seafile_account(token.clone()).await?;
    if seafile_repo_owner(token.clone(),repo_id.clone()).await?.to_lowercase()!=account.email.to_lowercase(){return Err("请连接此资料库所有者的云盘账号后同步权限".into());}
    let http=client()?;
    for (endpoint,kind) in [("shared-repos","群组或全员共享"),("shared-folders","子目录共享")] {
        let rows:Vec<Value>=check(http.get(format!("{BASE}/api/v2.1/{endpoint}/")).bearer_auth(&token).send().await.map_err(|e|e.to_string())?).await?.json().await.map_err(|e|e.to_string())?;
        if rows.iter().any(|r|r.get("repo_id").and_then(Value::as_str)==Some(repo_id.as_str()) && (endpoint=="shared-folders" || r.get("share_type").and_then(Value::as_str)!=Some("personal"))){return Err(format!("此资料库还有独立的{kind}，请先在云盘处理，组织不能保证仅靠成员权限撤回访问"));}
    }
    let links:Vec<Value>=check(http.get(format!("{BASE}/api/v2.1/share-links/")).bearer_auth(&token).query(&[("repo_id",repo_id.as_str()),("per_page","1")]).send().await.map_err(|e|e.to_string())?).await?.json().await.map_err(|e|e.to_string())?;
    if !links.is_empty(){return Err("此资料库还有公开分享链接，请先撤销；组织成员权限无法撤销独立的公开链接".into());}
    Ok(())
}
