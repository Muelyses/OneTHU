/** Actual daemon; synthetic school requests only. The first identity request
 * intentionally stalls until aborted or released by the parent test process. */
let release;
const held=new Promise(resolve=>{release=resolve;});
let first=true;
process.on('message',message=>{if(message==='release')release();});
globalThis.fetch=async(raw,init={})=>{
  const url=new URL(String(raw));
  if((init.method??'GET')!=='GET'||url.hostname!=='webvpn.tsinghua.edu.cn')throw Error('FIXTURE_NETWORK_FORBIDDEN');
  if(first){
    first=false;process.send?.('probe-held');
    await new Promise((resolve,reject)=>{
      const abort=()=>reject(new Error('fixture-aborted'));
      if(init.signal?.aborted)return abort();
      init.signal?.addEventListener('abort',abort,{once:true});
      void held.then(()=>{init.signal?.removeEventListener('abort',abort);resolve();});
    });
  }
  if(url.pathname==='/wengine-vpn/cookie')return new Response('XSRF-TOKEN=fixture-csrf;');
  if(url.pathname.endsWith('/grjbxx'))return Response.json({object:{ryh:'90000001'}});
  throw Error('FIXTURE_UNEXPECTED_SCHOOL_REQUEST');
};
const moduleUrl=process.env.ONETHU_STARTUP_DAEMON_MODULE??new URL('../../src/daemon.mjs',import.meta.url).href;
const {serve}=await import(moduleUrl);
await serve({dataDir:process.argv[2]});
if(process.connected)process.disconnect();
