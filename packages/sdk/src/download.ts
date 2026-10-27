import { constants } from 'node:fs';
import { lstat, realpath, open, unlink, link } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { LearnServicePorts } from './learn.js';
import type { NodeSession } from './node/session.js';

const LEARN_GATEWAY = '/https/77726476706e69737468656265737421fcf2408e297e7c4377068ea48d546d30ca8cc97bcc/';
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
function allowed(value: string) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !(u.hostname === 'learn.tsinghua.edu.cn' || u.hostname === 'webvpn.tsinghua.edu.cn' && u.pathname.startsWith(LEARN_GATEWAY))) fail('LEARN_RESOURCE_URL_REJECTED');
  return u.href;
}
async function safeDirectory(value: string) {
  if (!path.isAbsolute(value)) fail('CLI_OUTPUT_DIRECTORY_ABSOLUTE_REQUIRED');
  const resolved = path.resolve(value);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) fail('CLI_OUTPUT_DIRECTORY_SYMLINK');
    if (!info.isDirectory()) fail('CLI_OUTPUT_DIRECTORY_INVALID');
  }
  const canonical=await realpath(resolved);
  if ((process.platform==='win32'?canonical.toLowerCase():canonical)!==(process.platform==='win32'?resolved.toLowerCase():resolved)) fail('CLI_OUTPUT_DIRECTORY_SYMLINK');
  return resolved;
}
function filename(raw: string) {
  let result = raw.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '');
  const candidateExtension=path.extname(result),extension=candidateExtension.length<=20?candidateExtension:'';
  let stem=(extension?result.slice(0,-extension.length):result).slice(0,140-extension.length);
  // APFS/ext4 limit bytes, whereas NTFS limits UTF-16 code units. Reserve room
  // for the deterministic collision suffix on both kinds of filesystem.
  while(Buffer.byteLength(stem+extension,'utf8')>180)stem=stem.slice(0,-1);
  result=stem.replace(/[\uD800-\uDBFF]$/,'').replace(/[. ]+$/g,'')+extension;
  if (!result || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(result)) result = `resource-${result || 'file'}`;
  return result;
}
async function hashFile(file: string, guard: () => Promise<void>) {
  const st = await lstat(file);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) fail('CLI_OUTPUT_FILE_UNSAFE');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const hash = createHash('sha256');
  try {
    const opened=await handle.stat();
    if(opened.dev!==st.dev||opened.ino!==st.ino||!opened.isFile()||opened.nlink!==1)fail('CLI_OUTPUT_FILE_UNSAFE');
    for await (const chunk of handle.createReadStream({ autoClose: false })) {await guard();hash.update(chunk);}
    await guard();const after=await handle.stat();if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)fail('CLI_OUTPUT_FILE_CHANGED');
  }
  finally { await handle.close(); }
  return { hash: hash.digest('hex'), size: st.size };
}
/** Host-specific transport; the service registry supplies the trusted resource URL. */
export function createNodeDownloader(runtime: NodeSession, check: () => Promise<void>): LearnServicePorts['download'] {
  return async (input, control = {}) => {
    const directory = await safeDirectory(input.outputDir);
    const directoryIdentity = await lstat(directory);
    const monotonicEnd = performance.now() + Math.max(0, Math.min(input.remainingBudgetMs, 150000));
    const timeout = Math.max(1, Math.min(input.deadlineUnixMs - Date.now(), input.remainingBudgetMs, 150000));
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut=true;controller.abort(); }, timeout);
    const stop=()=>controller.abort();control.signal?.addEventListener('abort',stop,{once:true});
    if(control.signal?.aborted)stop();
    const assert = async () => {
      runtime.assertCurrent(input.expectedEpoch);
      if(control.signal?.aborted)fail('LEARN_DOWNLOAD_CANCELLED');
      if(timedOut||Date.now()>=input.deadlineUnixMs||performance.now()>=monotonicEnd)fail('LEARN_DOWNLOAD_DEADLINE_EXCEEDED');
      await check();await control.beforeWrite?.();
      runtime.assertCurrent(input.expectedEpoch);
      if(control.signal?.aborted)fail('LEARN_DOWNLOAD_CANCELLED');
      if(timedOut||Date.now()>=input.deadlineUnixMs||performance.now()>=monotonicEnd)fail('LEARN_DOWNLOAD_DEADLINE_EXCEEDED');
    };
    const assertDirectory=async()=>{await assert();await safeDirectory(directory);const now=await lstat(directory);if(now.dev!==directoryIdentity.dev||now.ino!==directoryIdentity.ino)fail('CLI_OUTPUT_DIRECTORY_CHANGED');};
    const temporary = path.join(directory, `.onethu-${randomUUID()}.part`);
    let created = false, response:Response|undefined;
    let published:{path:string;dev:number;ino:number}|undefined;
    // Delete only an inode created by this invocation. Existing collision files
    // and a path replaced by another process are never removed during rollback.
    async function rollbackPublished(){if(!published)return;try{await safeDirectory(directory);const st=await lstat(published.path);if(st.dev===published.dev&&st.ino===published.ino&&!st.isSymbolicLink())await unlink(published.path);}catch{/* keep any externally replaced path */}published=undefined;}
    try {
      await assertDirectory();
      let url = allowed(input.url);
      for (let hop = 0; hop < 8; hop++) {
        await assert();
        response = await runtime.http.request(url, { direct: true, redirect: 'manual', signal: controller.signal, ...({maxResponseBytes:4 * 1024 ** 3,preserveResponseBytes:true,timeoutMs:Math.max(1,Math.min(input.deadlineUnixMs-Date.now(),monotonicEnd-performance.now()))}) });
        await assert();
        if ([301,302,303,307,308].includes(response.status)) {
          const next = response.headers.get('location');
          await response.body?.cancel();
          if (!next) return fail('LEARN_DOWNLOAD_REDIRECT_INVALID');
          if(hop===7)fail('LEARN_DOWNLOAD_REDIRECT_LIMIT');
          url = allowed(new URL(next, url).href); continue;
        }
        break;
      }
      if (!response?.ok || !response.body) return fail('LEARN_DOWNLOAD_HTTP_ERROR');
      const mime = response.headers.get('content-type') ?? 'application/octet-stream';
      const htmlFile=/\.html?$/i.test(input.filename);
      if (/text\/html/i.test(mime) && !htmlFile) fail('LEARN_DOWNLOAD_LOGIN_PAGE');
      if (Number(response.headers.get('content-length')) > 4 * 1024 ** 3) fail('LEARN_DOWNLOAD_TOO_LARGE');
      await assertDirectory();
      const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); created = true;
      let bytes = 0; const hash = createHash('sha256'); const reader = response.body.getReader();
      const prefix=Buffer.alloc(8192);let prefixLength=0;
      function inspectPrefix(){
        const text=prefix.subarray(0,prefixLength).toString('utf8');
        // HTML teaching material is valid; authentication/portal documents are
        // never teaching attachments, including those named *.html upstream.
        if(/wengine-vpn|id\.tsinghua\.edu\.cn\/(?:do\/off|oauth)|<form[^>]+(?:login|auth)|(?:login|auth)\/form|统一身份认证/i.test(text)||(!htmlFile&&/<(?:!doctype\s+html|html|head|body)(?:\s|>)/i.test(text)))fail('LEARN_DOWNLOAD_LOGIN_PAGE');
      }
      try {
        while (true) {
          await assert();
          const next = await reader.read();await assert();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > 4 * 1024 ** 3) fail('LEARN_DOWNLOAD_TOO_LARGE');
          if(prefixLength<prefix.length){const copied=Math.min(prefix.length-prefixLength,next.value.length);prefix.set(next.value.subarray(0,copied),prefixLength);prefixLength+=copied;inspectPrefix();}
          hash.update(next.value); await file.writeFile(next.value);
        }
        inspectPrefix();await assert();await file.sync();await assert();
      } finally { await reader.cancel().catch(() => undefined); await file.close(); }
      const sha256 = hash.digest('hex');
      const base = filename(input.filename); const extension = path.extname(base); const stem = base.slice(0, base.length - extension.length);
      for (let collision = 0; collision < 1000; collision++) {
        await assertDirectory();
        const destination = path.join(directory, collision ? `${stem} (${collision})${extension}` : base);
        try {
          // Link commits atomically without overwriting. exFAT and filesystems
          // without hard links use an exclusively created, cancellable copy.
          try {await link(temporary,destination);const st=await lstat(temporary);published={path:destination,dev:st.dev,ino:st.ino};}
          catch(error){
            if(!['EXDEV','EPERM','EOPNOTSUPP','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??''))throw error;
            const target=await open(destination,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
            try{
              const st=await target.stat();published={path:destination,dev:st.dev,ino:st.ino};
              const source=await open(temporary,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
              try{for await(const chunk of source.createReadStream({autoClose:false})){await assertDirectory();await target.writeFile(chunk);}await assert();await target.sync();}
              finally{await source.close();}
            }finally{await target.close();}
          }
          await assertDirectory();
          const st=await lstat(destination);if(st.dev!==published!.dev||st.ino!==published!.ino||st.isSymbolicLink()||st.size!==bytes)fail('CLI_OUTPUT_FILE_CHANGED');
          published=undefined;
          return { absolutePath: destination, bytes, sha256, mime, reused: false };
        } catch (error) {
          if(published){await rollbackPublished();throw error;}
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const existing = await hashFile(destination,assert);
          await assertDirectory();
          if (existing.size === bytes && existing.hash === sha256) return { absolutePath: destination, bytes, sha256, mime, reused: true };
        }
      }
      return fail('CLI_OUTPUT_COLLISION_LIMIT');
    } catch (error) {
      await rollbackPublished();
      if(control.signal?.aborted)fail('LEARN_DOWNLOAD_CANCELLED');
      if(timedOut)fail('LEARN_DOWNLOAD_DEADLINE_EXCEEDED');
      throw error;
    } finally {
      clearTimeout(timer);controller.abort();control.signal?.removeEventListener('abort',stop);
      await response?.body?.cancel().catch(()=>undefined);
      if (created) await unlink(temporary).catch(() => undefined);
    }
  };
}
