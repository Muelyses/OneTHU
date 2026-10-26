import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { NodeSession } from '../node/session.js';
import type { RuntimeStore } from '../store.js';
import type { OperationContext, ServiceOperation } from './types.js';
import { check, fail, integer, object, operation, string, tuple } from './extendedSupport.js';

type Note = {permalink:string;title:string;type:string;tags:string[];modified:string;folder:string;path:string;raw:string;relations:string[]};
const MAX_NOTES=2000, MAX_NOTE_BYTES=1024*1024, MAX_SCAN_BYTES=32*1024*1024;
// Compatible with the existing OH Markdown frontmatter subset. No desktop
// imports, implicit cloud access, YAML execution or local credentials lookup.
function parse(raw:string, relative:string):Note {
  const fm=/^---\n([\s\S]*?)\n---(?:\n|$)/.exec(raw.replace(/\r\n/g,'\n'));
  if(!fm)fail('MEMORY_NOTE_INVALID');
  const values:Record<string,string>=Object.create(null);
  for(const line of fm[1]!.split('\n')){const m=/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);if(m)values[m[1]!]=m[2]!.trim();}
  const unquote=(v:string)=>/^(["']).*\1$/.test(v)?v.slice(1,-1):v;
  const title=unquote(values.title??''),permalink=unquote(values.permalink??'');
  if(!title||!permalink||title.length>1024||permalink.length>1024)fail('MEMORY_NOTE_INVALID');
  const tags=(values.tags??'').replace(/^\[|\]$/g,'').split(/[,，]/).map(t=>unquote(t.trim())).filter(Boolean);
  return {permalink,title,type:unquote(values.type??'note'),tags,modified:unquote(values.modified??''),folder:path.posix.dirname(relative)==='.'?'':path.posix.dirname(relative),path:relative,raw,
    relations:[...raw.matchAll(/^-\s+(?:(?:"[^"]+"|'[^']+'|[A-Za-z_][\w-]*)\s+)?\[\[([^\]]+)\]\]/gm)].map(m=>m[1]!)};
}
function folder(value='') {
  const clean=value.replace(/^\/+|\/+$/g,'');
  if(clean.includes('\\')||clean.split('/').some(p=>p==='..'||p==='.'||p.startsWith('.'))||/[\x00-\x1f]/.test(clean))fail('MEMORY_FOLDER_INVALID');
  return clean;
}
const inFolder=(note:Note,value:string)=>!value||note.folder===value||note.folder.startsWith(value+'/');
const metadata=({permalink,title,type,tags,modified,folder}:Note)=>({permalink,title,type,tags,modified,folder});
function normalized(value:string){return value.toLowerCase().replace(/[\s·・、，,。.：:（）()【】\[\]《》<>「」"']/g,'');}
/** Same score bands as the graphical host's serviceMatch, with bounded inputs. */
function serviceScore(name:string,query:string) {
  const n=normalized(name).slice(0,512),q=normalized(query).slice(0,256);if(!n||!q)return 0;
  if(n===q)return 100;if(n.includes(q))return 80+Math.min(15,q.length/n.length*15);if(q.includes(n))return 70;
  let i=0;for(const c of n){if(c===q[i])i++;if(i===q.length)return 40+q.length/n.length*20;}
  let longest=0;const row=new Array<number>(q.length+1).fill(0);
  for(const c of n){let diagonal=0;for(let j=1;j<=q.length;j++){const old=row[j]!;row[j]=c===q[j-1]?diagonal+1:0;longest=Math.max(longest,row[j]!);diagonal=old;}}
  return longest>=(/[\u4e00-\u9fff]/.test(q)?2:4)?20+Math.min(15,longest*3):0;
}

export function createLocalServices(runtime:NodeSession,_store?:RuntimeStore):ServiceOperation[] {
  async function notes(ctx:OperationContext,epoch:number):Promise<Note[]> {
    const owner=runtime.session.username;if(!owner)fail('AUTH_REQUIRED');
    const root=path.join(runtime.dataDir,'accounts',createHash('sha256').update(owner).digest('hex'),'memory');
    const guard=()=>check(runtime,ctx,epoch);guard();
    // Validate every existing component below the private runtime directory.
    let current=runtime.dataDir;
    try {for(const segment of path.relative(runtime.dataDir,root).split(path.sep)){
      current=path.join(current,segment);const st=await lstat(current);guard();
      if(st.isSymbolicLink()||!st.isDirectory())fail('MEMORY_DIRECTORY_UNSAFE');
    }}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return[];throw e;}
    if(await realpath(root)!==root)fail('MEMORY_DIRECTORY_UNSAFE');
    const result:Note[]=[];const permalinks=new Set<string>();let totalBytes=0,visited=0;
    async function walk(dir:string,relative:string,depth:number) {
      guard();if(depth>8)fail('MEMORY_SCAN_LIMIT');
      const before=await lstat(dir);if(!before.isDirectory()||before.isSymbolicLink())fail('MEMORY_DIRECTORY_UNSAFE');
      const entries=await readdir(dir,{withFileTypes:true});
      for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
        guard();if(entry.name.startsWith('.'))continue;if(++visited>10000)fail('MEMORY_SCAN_LIMIT');
        const file=path.join(dir,entry.name),name=relative?relative+'/'+entry.name:entry.name;
        const st=await lstat(file);if(st.isSymbolicLink())fail('MEMORY_FILE_UNSAFE');
        if(st.isDirectory()){await walk(file,name,depth+1);continue;}
        if(!/\.md$/i.test(entry.name))continue;
        if(!st.isFile()||st.nlink!==1)fail('MEMORY_FILE_UNSAFE');
        if(st.size>MAX_NOTE_BYTES||result.length>=MAX_NOTES||(totalBytes+=st.size)>MAX_SCAN_BYTES)fail('MEMORY_SCAN_LIMIT');
        const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
        let raw:string;try{const opened=await handle.stat();if(opened.dev!==st.dev||opened.ino!==st.ino||opened.size!==st.size||opened.nlink!==1)fail('MEMORY_FILE_CHANGED');raw=await handle.readFile('utf8');if(Buffer.byteLength(raw)>MAX_NOTE_BYTES)fail('MEMORY_SCAN_LIMIT');}finally{await handle.close();}
        guard();const note=parse(raw,name);if(permalinks.has(note.permalink))fail('MEMORY_PERMALINK_AMBIGUOUS');permalinks.add(note.permalink);result.push(note);
      }
      const after=await lstat(dir);if(after.dev!==before.dev||after.ino!==before.ino||after.isSymbolicLink())fail('MEMORY_DIRECTORY_CHANGED');
    }
    await walk(root,'',0);guard();return result;
  }
  const base='Read only this account’s Markdown notes in accounts/<account SHA-256>/memory. OH cloud memory is separate and is not connected.';
  let serviceCache:{epoch:number;at:number;items:any[]}|undefined;
  const ops=[
    operation('memory.ready','memory:read',async(_args,ctx)=>(await notes(ctx,runtime.epoch())).length>0,{authenticated:false,description:base+' Return whether valid local notes exist.'}),
    operation('memory.list','memory:read',async([opts={}],ctx)=>{const prefix=folder(opts.folder);return(await notes(ctx,runtime.epoch())).filter(n=>inFolder(n,prefix)&&(!opts.tag||n.tags.includes(opts.tag))).sort((a,b)=>b.modified.localeCompare(a.modified)).map(metadata);},{authenticated:false,description:base+' List metadata without note bodies.',parameters:tuple([object({folder:string(512),tag:string(128)},[])],0)}),
    operation('memory.read','memory:read',async([permalink],ctx)=>{const match=(await notes(ctx,runtime.epoch())).find(n=>n.permalink===permalink);if(!match)fail('MEMORY_NOT_FOUND');const bytes=Buffer.from(match.raw);if(bytes.length<=8192)return match.raw;return new TextDecoder('utf8',{fatal:false}).decode(bytes.subarray(0,8192)).replace(/\uFFFD$/,'')+'\n\n… [truncated at 8 KiB]';},{authenticated:false,description:base+' Read by permalink, bounded to 8 KiB of UTF-8.',parameters:tuple([string(1024)])}),
    operation('memory.search','memory:read',async([query={}],ctx)=>{
      const prefix=folder(query.folder),terms=String(query.query??'').toLowerCase().split(/\s+/).filter(Boolean),limit=query.limit??8;
      const candidates=(await notes(ctx,runtime.epoch())).filter(n=>inFolder(n,prefix)&&(!query.type||n.type===query.type)&&(!query.tags?.length||query.tags.some((tag:string)=>n.tags.includes(tag))));
      const hits=candidates.map(n=>{let score=terms.length?0:1,snippet='';for(const term of terms){if(n.title.toLowerCase().includes(term))score+=3;if(n.tags.some(tag=>tag.toLowerCase().includes(term)))score+=2;const at=n.raw.toLowerCase().indexOf(term);if(at>=0){score++;snippet||=n.raw.slice(Math.max(0,at-30),at+term.length+60).replace(/\s+/g,' ');}}return{...metadata(n),path:n.path,score,snippet};}).filter(n=>n.score>0);
      const titles=new Set(hits.map(n=>n.title)),existing=new Set(hits.map(n=>n.permalink));
      if(terms.length)for(const n of candidates){if(existing.has(n.permalink))continue;const via=n.relations.find(target=>titles.has(target));if(via)hits.push({...metadata(n),path:n.path,score:0.5,snippet:`${n.title} → ${via}`});}
      return hits.sort((a,b)=>b.score-a.score||b.modified.localeCompare(a.modified)).slice(0,limit);
    },{authenticated:false,description:base+' Keyword scoring, tag/type/folder filters and one relation hop.',parameters:tuple([object({query:string(512),tags:{type:'array',items:string(128),maxItems:32},type:string(128),folder:string(512),limit:integer(1,100)},[])])}),
    operation('services.search','info:read',async([query,limit=10],ctx)=>{
      if(!normalized(query))return[];const epoch=runtime.epoch();check(runtime,ctx,epoch);
      if(!serviceCache||serviceCache.epoch!==epoch||Date.now()-serviceCache.at>300000){
        await runtime.helper.prepareThosSession();check(runtime,ctx,epoch);
        const page=await runtime.helper.getThosServices();check(runtime,ctx,epoch);
        if(!page?.complete)fail('SERVICES_ENUMERATION_INCOMPLETE');
        serviceCache={epoch,at:Date.now(),items:page.items};
      }
      return serviceCache.items.filter(item=>typeof item.name==='string').map(item=>({id:item.id,name:item.name,department:item.department,url:item.url,score:serviceScore(item.name,query)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.name.length-b.name.length).slice(0,limit);
    },{parameters:tuple([string(256),integer(1,50)],1),description:'Search the official THOS service directory and return addresses; this does not open a browser. Scores ≥40 indicate a close name match, 20–39 are candidates. The account-local in-memory cache lasts five minutes.'}),
  ];
  return ops.map(op=>({...op,async run(args,ctx){const epoch=runtime.epoch();check(runtime,ctx,epoch);const result=await op.run(args,ctx);check(runtime,ctx,epoch);return result;}}));
}
