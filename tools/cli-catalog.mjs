// Generate reviewed CLI signatures from the public facade. New facade methods are
// deliberately NOT exposed until added to this explicit capability list.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
const source = ts.createSourceFile('types.ts', readFileSync(new URL('../apps/desktop/src/plugins/types.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const read = {
  session: 'status username', user: 'info',
  contacts: 'list get', organizations: 'list get', xiaoda: 'status agents models balance conversations conversation skills skill installed', vault: 'list items item readText',
  info: 'schedule report exams deadlines news newsDetail searchNews newsSub schoolCalendar classroomList classroomState invoices bankPayments graduateIncome dormScore physicalExam assessmentList',
  learn: 'semesters bbsBoards bbsThreads bbsThread bbsPosts',
  venue: 'scenes currentPage myRecords', xk: 'search catalog selected detail reviews',
  coursex: 'semesters search detail', cal: 'agenda', mail: 'list search read',
  cloud: 'repos list search', memory: 'search read list ready',
  card: 'info transactions', dorm: 'eleRemainder elePayRecord',
  library: 'list floors sections seats records', libroom: 'list resources records fuzzyMember',
  network: 'balance devices deviceCount accountInfo', kongjian: 'page my',
  gitlab: 'projects starred search project branches tree file issues issue issueNotes mergeRequests mergeRequest mergeRequestNotes pipelines jobs jobTrace discussions awards requestCounts mergeRequestChanges',
  exthw: 'snapshot', yuketang: 'status courses contents homework homeworkDetail leafDetail noticeDetail', services: 'search',
};
const write = {
  xiaoda: 'importSkill enableSkill removeSkill ask',
  organizations: 'create update saveProject removeProject saveAnnouncement removeAnnouncement',
  vault: 'create rename addText addAtom addFile removeItem share importCode',
  learn: 'reply post', library: 'book cancel', libroom: 'book cancel', venue: 'cancel jump',
  kongjian: 'book cancel', cal: 'add edit remove', mail: 'send',
  cloud: 'share',
  visit: 'fill', nav: 'go', services: 'open', exthw: 'refresh',
  gitlab: 'createIssue comment updateComment reply deleteComment resolveDiscussion assignees react unreact createMergeRequest mergeMergeRequest setState',
};
function schema(n) {
  if (!n) throw Error('Missing parameter type');
  const primitive = { [ts.SyntaxKind.StringKeyword]: 'string', [ts.SyntaxKind.NumberKeyword]: 'number', [ts.SyntaxKind.BooleanKeyword]: 'boolean' }[n.kind];
  if (primitive) return { type: primitive };
  if (n.kind === ts.SyntaxKind.UnknownKeyword || n.kind === ts.SyntaxKind.AnyKeyword) return {};
  if (ts.isParenthesizedTypeNode(n)) return schema(n.type);
  if (ts.isLiteralTypeNode(n)) return { enum: [JSON.parse(n.literal.getText(source).replace(/^'(.*)'$/, '"$1"'))] };
  if (ts.isUnionTypeNode(n)) return { anyOf: n.types.map(schema) };
  if (ts.isArrayTypeNode(n)) return { type: 'array', items: schema(n.elementType), maxItems: 10000 };
  if (ts.isTypeLiteralNode(n)) {
    const properties = {}, required = [];
    for (const m of n.members) {
      if (!ts.isPropertySignature(m)) throw Error('Unsupported object member');
      const key = m.name.getText(source); properties[key] = schema(m.type);
      if (!m.questionToken) required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false };
  }
  if (ts.isTypeReferenceNode(n)) {
    const name = n.typeName.getText(source);
    if (name === 'Array') return { type: 'array', items: schema(n.typeArguments[0]), maxItems: 10000 };
    if (name === 'Record') return { type: 'object', additionalProperties: schema(n.typeArguments[1]) };
  }
  // The room resource is obtained from libroom.resources; revalidated by the app.
  if (ts.isImportTypeNode(n) && n.qualifier?.getText(source) === 'LibRoomRes') return { type: 'object', required: ['devId', 'devName', 'kindId', 'roomId'], properties: { devId: { type: 'number' }, devName: {type:'string'}, kindId: {type:'number'}, roomId: {type:'number'} }, additionalProperties: true };
  throw Error(`Unsupported parameter type: ${n.getText(source)}`);
}
const iface = source.statements.find(n => ts.isInterfaceDeclaration(n) && n.name.text === 'OnethuApi');
const operations = [];
for (const [group, names] of Object.entries(read)) for (const method of names.split(' ')) operations.push({ group, method, mutation: false });
for (const [group, names] of Object.entries(write)) for (const method of names.split(' ')) operations.push({ group, method, mutation: true });
const out = operations.map(({ group, method, mutation }) => {
  const ns = iface.members.find(n => n.name.getText(source) === group);
  const member = ns?.type?.members?.find(n => n.name.getText(source) === method);
  if (!member || !ts.isMethodSignature(member)) throw Error(`Missing facade operation ${group}.${method}`);
  const parameters = { type: 'array', items: member.parameters.map(p => ({ ...schema(p.type), title: p.name.getText(source) })), minItems: member.parameters.filter(p => !p.questionToken && !p.initializer).length, maxItems: member.parameters.length, additionalItems: false };
  const description = member.jsDoc?.map(d => typeof d.comment === 'string' ? d.comment : '').filter(Boolean).join(' ') || `${group}.${method}`;
  return { name: `${group}.${method}`, description, parameters, mutation };
}).sort((a,b) => a.name.localeCompare(b.name));
const targets = ['../apps/desktop/src/cli/catalog.json', '../packages/sdk/src/catalog.json'].map(file => new URL(file, import.meta.url));
const contents = JSON.stringify(out, null, 2) + '\n';
for (const target of targets) {
  if (process.argv.includes('--check')) {
    if (readFileSync(target,'utf8') !== contents) throw Error('CLI catalog is stale: node tools/cli-catalog.mjs');
  } else writeFileSync(target, contents);
}
console.log(`CLI catalog: ${out.length} reviewed operations`);
