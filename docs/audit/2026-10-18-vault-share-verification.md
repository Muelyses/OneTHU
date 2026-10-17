# 暂存箱 / 口令 / 组织 / 名片：验证矩阵（2026-10-18）

> 用途：区分「已自动验证」「已真实云盘验证」「仍待真机/真实账号验证」，避免把未验证项当成完成。

## 自动化回归（本机可复跑）

| 领域 | 命令 | 当前结果 |
|---|---|---|
| 暂存箱全链路（拖拽来源、文件通道、口令、触屏、云适配器 fake） | `node tools/vault-browser-test.mjs` | 39/39 |
| 设置行/OS 文件/主题/插件拖拽来源 | 含在 vault 套件 | ✓ |
| 手机暂存箱/名片/组织布局（390/320） | `node tools/mobile-vault-browser-test.mjs` | 13/13 |
| 名片 | `node tools/namecard-browser-test.mjs` | 7/7 |
| 组织（建/成员/邀请/共享空间） | `node tools/org-browser-test.mjs` | 9/9 |
| 好友通道（本机留言回退） | `node tools/friend-channel-browser-test.mjs` | 6/6 |
| 手势竞技场纯逻辑 | `node --import ./tools/ts-resolve-register.mjs tools/gesture-arena-test.mjs` | 9/9 |
| 分享引用账本 | `node --import ./tools/ts-resolve-register.mjs tools/share-refs-test.mjs` | 8/8 |
| 手机返回键命令/ACL 一致性 | `node tools/mobile-nav-test.mjs` | 4/4 |
| 动效纪律 | `node tools/motion-test.mjs` | 142/142 |
| 云盘路由/检索行 | `node tools/oh-routes-sync-test.mjs` / `search-landing-test.mjs` | ✓ |

## 真实清华云盘 live（需 token，非 CI）

| 项 | 命令/脚本 | 结果 |
|---|---|---|
| API 形状、目录分享、匿名读、撤销、单文件分享 | `SEAFILE_TOKEN=… node tools/cloud-smoke-live.mjs` | 11 步 PASSED |
| Rust 分享读取（目录 dirent_list + 单文件 /f direct） | `TSINGHUA_SEAFILE_TOKEN=… cargo test live_share_read_dir_and_file --lib -- --ignored` | 1 passed |
| App UI：生成云口令 → 第二上下文导入（含 files/）→ UI 撤销 | `SEAFILE_TOKEN=… node tools/cloud-ui-live-test.mjs` | 11/11 |

live 关键结论：
- 目录分享可用；匿名响应 `{"dirent_list":[{file_name,is_dir,folder_name,...}]}`；
- 单文件分享链接 `/f/<token>/`，`dirents` 400，需 direct `/d/<token>/files/?p=/&dl=1`；
- 撤销后链接拒绝、目录可递归删除。

## Android 构建/模拟器（2026-10-18）

- Kotlin 插件 + app 实编译 `BUILD SUCCESSFUL`；debug APK 打包成功。
- 模拟器 `onethu-demo` 安装、冷启动进入登录页；返回键退出、无崩溃。
- 运行手册：`docs/audit/2026-10-18-android-build-runbook.md`。
- 模拟器无 NFC、未登录，NFC/暂存箱/云端 UI 仍待真机/真实账号。

## 仍待验证（不能声称完成）

1. **NFC 真机双机**：Android ReaderMode 接收 + HCE NDEF 发送代码已落地；无设备，AID 路由/默认应用/分块读取未验证。
2. **双向好友通道**：已接 `/api2/repos/{id}/dir/shared_items/`（`seafile_share_folder_to_user`），
   名片可填云盘邮箱、共享云盘创建后自动/手动开通 rw；live 已验证 owner 拒绝路径，
   **成功路径仍需第二真实账号验证**（对方账号能否看到并写入）。
3. **扫码**：BarcodeDetector 无头下识别不到高密度 ONTOUCH1 截图；已加放大兜底与超时，真机相机/截图未验证。
4. **手机全量 UI**：真机上的拖拽/动画/无障碍/低端机性能未验收；`mobile_exit` 已补但真机返回键未验证。
5. **组织真实协作**：成员邀请/云空间链接已通；成员账号加入、权限、GitLab 组织空间未验证。

## 完成口径

只有上述 1–5 都有设备/第二账号证据，且自动化回归保持全绿，才能把 goal 标记完成。
