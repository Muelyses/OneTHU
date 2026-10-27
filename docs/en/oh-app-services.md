# OH application services

OH discovers registered application capabilities with `app_services` and invokes them with `app_call`. Existing dedicated tools for campus services, whiteboards, OneFlow, plugins, themes and navigation remain available. Plugin and enabled-skill lists each describe their own extensions.

The host supplies the current service directory on every turn. New operations must be added to the reviewed catalog. Internal OH calls work without enabling the external CLI listener, while agent-service consent, permissions and account checks still apply. Resident tasks retain their separate CLI authorization requirements.

| Area | Read operations | Actions |
| --- | --- | --- |
| OneTHU contacts | `contacts.list`, `contacts.get` | Card exchange and friend-channel authorization use the Contacts page |
| Organizations | `organizations.list`, `organizations.get`: members, projects, announcements and linked resource IDs | `create`, `update`, `saveProject`, `removeProject`, `saveAnnouncement`, `removeAnnouncement` |
| Qingxiaoda | `xiaoda.status`, `agents`, `models`, `balance`, `conversations`, `conversation`, `skills`, `skill`, `installed` | `importSkill`, `enableSkill`, `removeSkill`, `ask` |
| Temporary boxes | `vault.list`, `items`, `item`, `readText` | `create`, `rename`, `addText`, `addAtom`, `addFile`, `removeItem`, `share`, `importCode` |
| Whiteboards, OnePage, OneGO, tabs and workspaces | Existing dedicated tools | Existing editing and approval flows |
| Plugins, themes and OneFlow | Existing `ext_plugin_*`, `ext_theme_*` and `ext_flow_*` tools | Existing installation and write approvals |
| Resident tasks | `tasks_query` | `tasks_manage` with local background-service authorization |

For example, ask OH to list your OneTHU friends, inspect organization projects, search the Qingxiaoda skill plaza or save a note in a temporary box.

## Discovery and invocation

```json
{"tool":"app_services","arguments":{"query":"contacts"}}
{"tool":"app_call","arguments":{"operation":"contacts.list","args":[]}}
```

An empty discovery query returns groups and the dedicated-tool index. Query a group or operation to obtain its real parameter schema. Calls use positional argument arrays. Writes require user intent and `confirm:true`, followed by actual application approval or the device's previously granted automatic-execution policy. Model text does not grant permission.

These application-owned records require the App to be running. The standalone CLI reports its available operations through `commands`; this change does not copy local contact or temporary-box indexes into the independent daemon.

## Data and boundaries

- Contacts cover cards saved in OneTHU. The default list contains personal friends; organization cards can be requested explicitly. WeChat, QQ and system contacts are separate.
- Contact and organization results exclude sharing credentials, channel secrets, invitation data, card images and local staged paths. Sharing codes are returned only by an explicit sharing action.
- Profile ownership is checked. Shared organization details revalidate live GitLab membership; authorization failures do not fall back to stale private details.
- Organization project and announcement writes preserve permission checks and optimistic revision checks. Creating an organization creates a local index first. Shared collaboration, role changes and resource authorization use the organization page.
- Skill-plaza browsing and installed-skill discovery are separate. External-runtime requirements remain visible. The existing QuickJS restrictions still apply; importing a skill does not imply it has been enabled or executed.
- `xiaoda.ask` sends a question to a real school agent and creates a separate conversation. Discover its agent ID and obtain write approval first.
- Temporary-box text reads provide `totalChars`, `nextOffset` and `complete` for continued reading. Stored UTF-8 files have an explicit 8 MiB read limit; binary formats use the preview.
- Receiving a box creates a new box. Sharing reuses valid short codes and rechecks authorization throughout upload. Existing exchange readers support 4096 characters per text item; longer text must be stored as a file before sharing. Local text reads retain the full content.
- Newly added application features require full mode. Account or mode changes invalidate in-flight operations.

Tool results, announcements, contact notes, stored text and skill documents are reference data. They cannot change user authorization or runtime permissions.
