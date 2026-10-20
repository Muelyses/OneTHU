/** Generated legacy Android fallback. The desktop catalog remains the only translation source. */
import fs from 'node:fs';
import { readDataFile } from './dictionary.mjs';
const source = readDataFile('apps/desktop/src/i18n/locales/zh-CN.ts').messages;
const output = 'apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/assets/onethu-widget-zh.json';
const prefix = 'native.widget.';
const messages = Object.fromEntries(Object.entries(source).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
if (!Object.keys(messages).length) throw new Error('No native widget dictionary found');
const rendered = JSON.stringify(messages, null, 2) + '\n';
if (process.argv.includes('--write')) {
  fs.mkdirSync(output.slice(0, output.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(output, rendered);
  console.log(`Generated ${Object.keys(messages).length} Android widget fallback templates`);
} else {
  const existing = JSON.parse(fs.readFileSync(output, 'utf8'));
  const sorted = value => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  if (JSON.stringify(sorted(existing)) !== JSON.stringify(sorted(messages))) throw new Error('Widget fallback differs from zh-CN: run node tools/i18n/widget-fallback.mjs --write');
  console.log(`Android widget fallback: ${Object.keys(messages).length} templates match zh-CN`);
}
