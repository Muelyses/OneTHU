# OH 应用服务

OH 的内建能力通过 `app_services` 查询，通过 `app_call` 调用。已有学校查询、白板、OneFlow、插件、主题和导航专用工具继续可用。插件清单和已启用技能清单各自只覆盖扩展内容。

每轮对话从宿主读取当前服务目录。新服务需要登记到审核目录；模型获得实际操作名、参数与写操作标记。应用内部调用无需打开对外 CLI 监听，仍须授权智能体服务。后台任务继续要求 CLI 授权。

## 已接入的应用功能

| 功能 | 查询 | 操作 |
| --- | --- | --- |
| OneTHU 通讯录 | `contacts.list`、`contacts.get`：好友、收到的名片 | 名片交换与好友通道授权在通讯录页面完成 |
| 组织 | `organizations.list`、`organizations.get`：成员、项目、公告、云盘与 GitLab 资源引用 | `create`、`update`、`saveProject`、`removeProject`、`saveAnnouncement`、`removeAnnouncement` |
| 清小搭 | `xiaoda.status`、`agents`、`models`、`balance`、`conversations`、`conversation`、`skills`、`skill`、`installed` | `importSkill`、`enableSkill`、`removeSkill`、`ask` |
| 暂存箱 | `vault.list`、`items`、`item`、`readText` | `create`、`rename`、`addText`、`addAtom`、`addFile`、`removeItem`、`share`、`importCode` |
| 白板、OnePage、OneGO、标签页、工作区 | 原有 `onePage_*`、`ext_onepage_*`、`ext_tab`、`ext_workspace_*` 等专用工具 | 保留原有编辑和确认流程 |
| 插件、主题、OneFlow | 原有 `ext_plugin_*`、`ext_theme_*`、`ext_flow_*` 等工具 | 保留现有安装与写操作审批 |
| 常驻任务 | `tasks_query` | `tasks_manage`，按本机后台授权执行 |

可直接问 OH：“我的 OneTHU 好友都有谁”“看看我的组织有哪些项目”“在清小搭技能广场找课件整理技能”“查看暂存箱里的文字”“把这段笔记收进暂存箱”。

## 发现与调用

开发者可以先查询分组，再按返回的 `parameters` 传位置参数数组：

```json
{"tool":"app_services","arguments":{"query":"contacts"}}
{"tool":"app_call","arguments":{"operation":"contacts.list","args":[]}}
```

`app_services` 不带 query 返回分组和专用工具索引。也可以按组织、清小搭、暂存箱、插件或白板检索。写操作需要用户明确意图，调用时设置 `confirm:true`，并由应用真实审批或本机已有自动执行策略决定是否执行。模型返回的确认文字本身不授予权限。

这组接口读取当前 App 的数据，需要 App 运行。独立 CLI 的可用能力以其 `commands` 目录为准；本轮没有把本地通讯录与暂存箱复制到独立 daemon。

## 数据与权限

- 通讯录只读取已保存在 OneTHU 中的名片。列表默认只含个人好友，可显式请求组织名片；不访问微信、QQ 或系统通讯录。
- 好友共享口令、通道密钥、邀请信息、头像原图和本地暂存路径不进入名单与详情结果。需要分享口令时显式调用分享操作。
- 通讯录和组织读取核验个人资料归属。远程组织详情重新验证 GitLab 成员身份，拒绝时保留真实错误，不用旧缓存充当在线结果。
- 组织项目与公告写入复用权限检查和版本冲突检查。创建组织先建立本地索引；共享协作、成员角色和资源授权在组织页显式确认。
- 清小搭技能广场和已安装技能分别查询。依赖 Python、Node 或外部环境的技能会说明要求；既有 QuickJS 运行限制继续生效。导入不代表已启用或已经运行。
- `xiaoda.ask` 会向指定学校智能体发送问题并创建独立会话，须先查询真实 agent id，再通过写操作审批。
- 暂存箱文本读取返回 `totalChars`、`nextOffset`、`complete`，可继续读取下一段。存储文件的 UTF-8 文本读取上限为 8 MiB，超限会报错；二进制格式由预览处理。
- 暂存箱接收口令创建新箱，保留当前箱。分享复用有效短码，上传过程持续复核授权与账号。现有交换接收器每条文字支持 4096 字符，超过时分享会明确拒绝，可先保存为文件；本地读取仍保留全文。
- 新增应用功能在完整模式开放。切换模式或账号会使在途操作失效。

工具结果、公告正文、名片备注、暂存文字和技能文档均作为资料处理；它们不能改变用户授权或运行环境。
