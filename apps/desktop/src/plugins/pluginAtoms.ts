/**
 * 插件原子注册表（万物原子化 · 动态侧）——插件经 ctx.registerAtom 注册
 * 自己的原子的种类（kind = `plugin:<pluginId>`），使插件产出的结果能像
 * 课程/作业/通知一样收进用户收藏夹、被 AtomPicker 搜索。
 * 原子 key 的编解码由插件自持（本表只负责 kind → 展示元数据解析）。
 */

export interface PluginAtomResolved {
  title: string;
  /** 第二行说明 */
  sub?: string;
}

export interface PluginAtomDef {
  /** 原子种类，固定 `plugin:<pluginId>` */
  kind: string;
  pluginId: string;
  /** 搜索/收藏夹里的分类标签（如「打卡」「单词」） */
  group: string;
  /** 卡片图标：inline SVG 字符串（缺省用拼图占位） */
  iconSvg?: string;
  /** key → 展示元数据；返回 null = 原子已失效（收藏夹里降级显示） */
  resolve: (key: string) => PluginAtomResolved | null;
  /** 点击行为：深链参数（传给插件 tab；缺省只跳 tab） */
  paramOf?: (key: string) => string;
}

const atoms = new Map<string, PluginAtomDef>();

export function pluginAtomKindOf(pluginId: string): string {
  return `plugin:${pluginId}`;
}

export function registerPluginAtom(def: PluginAtomDef): void {
  if (!def.kind.startsWith("plugin:")) return;
  atoms.set(def.kind, def);
}

export function unregisterPluginAtoms(pluginId: string): void {
  atoms.delete(pluginAtomKindOf(pluginId));
}

export function getPluginAtom(kind: string): PluginAtomDef | undefined {
  return atoms.get(kind);
}

export function pluginAtomKinds(): string[] {
  return [...atoms.keys()];
}
