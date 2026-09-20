/**
 * MCP 服务器管理存储（宿主侧结构化）——OH 的 MCP 服务器不再是一个 JSON 设置项，
 * 而是逐条管理：name / command / args / env。UI（插件页 OH 卡片「MCP」入口）
 * 增删改写这里；OH settings.get 读 mcpServers 键时由 facade 注入本表的 JSON。
 */
const LS_KEY = "onethu.mcp.servers.v1";

export interface McpServerEntry {
  name: string;
  command: string;
  /** 传给 server 的参数（不含 command 本身） */
  args: string[];
  /** 环境变量（KEY=VALUE 对） */
  env: Record<string, string>;
}

export function loadMcpServers(): McpServerEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as McpServerEntry[];
    return Array.isArray(v)
      ? v.filter((x) => x && typeof x.name === "string" && typeof x.command === "string" && x.name && x.command)
      : [];
  } catch {
    return [];
  }
}

export function saveMcpServers(list: McpServerEntry[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* 忽略配额错误 */
  }
}

/** 注入 OH settings（mcpServers 键）——供 facade settings.get 调用 */
export function mcpServersJsonForSettings(): string {
  const list = loadMcpServers();
  return list.length ? JSON.stringify(list) : "";
}
