import { fail, pluginId, relativePath } from './security.mjs';

export const GUI_NAMESPACES = new Set(['org:write','xiaoda:chat','vault:write','ui', 'nav', 'theme', 'clipboard', 'widget', 'webview', 'notify', 'favorites']);
const PERMISSIONS = new Set(['contacts:read','org:read','xiaoda:read','xiaoda:manage','vault:read','user:read','info:read','card:read','dorm:read','library:read','library:book','network:read','learn:read','learn:write','venue:read','venue:book','xk:read','kongjian:book','cal:read','cal:write','mail:read','mail:write','cloud:read','cloud:write','memory:read','memory:write','gitlab:read','gitlab:write','nav','ui','storage','net:external','ws:external','tsinghua:sdk','clipboard:read','plugins:call','css','llm','theme','exthw:read','exthw:refresh','webview','widget','notify']);
export function validateManifest(value, files) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('PLUGIN_INVALID_MANIFEST');
  pluginId(value.id);
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200 || typeof value.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.+-]+)?$/.test(value.version)) fail('PLUGIN_INVALID_MANIFEST');
  if (!Array.isArray(value.permissions) || value.permissions.length > 64 || value.permissions.some(item => !PERMISSIONS.has(item)) || new Set(value.permissions).size !== value.permissions.length) fail('PLUGIN_INVALID_PERMISSIONS');
  const kind = value.kind ?? 'js';
  if (!['js', 'rust', 'wasm'].includes(kind)) fail('PLUGIN_UNSUPPORTED_RUNTIME');
  if (value.settings !== undefined && (!Array.isArray(value.settings) || value.settings.length > 100 || value.settings.some(field => !field || typeof field.key !== 'string' || !/^[a-zA-Z][\w.-]{0,99}$/.test(field.key) || !['text','password','textarea','select'].includes(field.type)))) fail('PLUGIN_INVALID_SETTINGS');
  let entry = kind === 'rust' ? value.bin : value.entry;
  if (!entry && kind === 'js') {
    const candidates = [...files.keys()].filter(name => !name.includes('/') && /\.(?:m?js)$/.test(name));
    if (candidates.length === 1) entry = candidates[0];
  }
  if (kind !== 'wasm' || entry) {
    relativePath(entry);
    if (!files.has(entry) || entry === 'manifest.json') fail('PLUGIN_ENTRY_MISSING');
  }
  if (kind === 'js' && !/\.(?:m?js)$/.test(entry)) fail('PLUGIN_INVALID_ENTRY');
  const manifest = { ...value, kind, ...(kind === 'rust' ? { bin: entry } : entry ? { entry } : {}) };
  return manifest;
}
export function compatibility(manifest) {
  const reason = manifest.kind === 'wasm' ? 'WASM_PLUGIN_ABI_UNAVAILABLE' : manifest.category === 'theme' ? 'GUI_CAPABILITY_UNAVAILABLE' : null;
  return { supported: reason === null, runtime: manifest.kind === 'js' ? 'node-esm' : manifest.kind === 'rust' ? 'stdio-native' : null,
    ...(reason ? { reason } : {}), trustedLocalCode: true,
    unavailableCapabilities: ['DOM', 'tabs', 'CSS', 'themes', 'clipboard', 'widgets', 'native-notifications', 'webview'],
    note: 'JS plugins must use headless APIs. Native executables must match this operating system and architecture. Neither runtime is an OS sandbox.' };
}
export function validateCommands(commands) {
  if (!Array.isArray(commands) || commands.length > 200) fail('PLUGIN_INVALID_COMMANDS');
  const seen = new Set();
  return commands.map(command => {
    if (!command || typeof command.id !== 'string' || !/^[a-zA-Z0-9][\w.-]{0,99}$/.test(command.id) || seen.has(command.id) || typeof command.title !== 'string' || command.title.length > 300) fail('PLUGIN_INVALID_COMMANDS');
    seen.add(command.id);
    return { id: command.id, title: command.title, ...(typeof command.inputLabel === 'string' ? { inputLabel: command.inputLabel.slice(0,300) } : {}) };
  });
}
