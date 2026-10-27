import { createInterface } from 'node:readline/promises';
import { CliError } from './client.mjs';

async function secret(stdin,stderr,prompt) {
  if(!stdin.isTTY||typeof stdin.setRawMode!=='function')throw new CliError('TTY_REQUIRED','Use --password-stdin when no terminal is attached.',2);
  stderr.write(prompt);const wasRaw=stdin.isRaw;
  stdin.setRawMode(true);stdin.resume();let value='';
  try{return await new Promise((resolve,reject)=>{
    function data(chunk){for(const char of chunk.toString('utf8')){
      if(char==='\u0003'){finish();reject(new CliError('LOGIN_CANCELLED','Login cancelled.',2));return;}
      if(char==='\r'||char==='\n'){finish();resolve(value);return;}
      if(char==='\u007f'||char==='\b')value=value.slice(0,-1);
      else if(char>=' '&&value.length<4096)value+=char;
    }}
    function finish(){stdin.off('data',data);stderr.write('\n');}
    stdin.on('data',data);
  });}finally{stdin.setRawMode(wasRaw??false);stdin.pause();}
}
export async function login(runtime,options,{stdin,stderr}) {
  let username=options.username;
  if(!username){if(!stdin.isTTY)throw new CliError('USERNAME_REQUIRED','Supply --username when using --password-stdin.',2);const rl=createInterface({input:stdin,output:stderr});try{username=await rl.question('University account / 学号：');}finally{rl.close();}}
  let password;
  if(options.passwordStdin){let text='';for await(const chunk of stdin){text+=chunk;if(Buffer.byteLength(text)>8192)throw new CliError('PASSWORD_INPUT_LIMIT','Password input is too large.',2);}password=text.replace(/\r?\n$/,'');}
  else password=await secret(stdin,stderr,'Password / 密码（隐藏输入）：');
  let result;
  try{result=await runtime.auth.login({username,password,trustDevice:options.trustDevice===true});}
  finally{password='';}
  if(result.state==='need-2fa'){
    if(!stdin.isTTY){await runtime.auth.twoFactor.cancel();throw new CliError('TWO_FACTOR_INTERACTIVE_REQUIRED','Two-factor authentication is required. Run onethu auth login in an interactive terminal.',2,{methods:result.methods});}
    const rl=createInterface({input:stdin,output:stderr});
    try{
      stderr.write(result.methods.map((m,i)=>`${i+1}. ${m.type}${m.detail?` (${m.detail})`:''}`).join('\n')+'\n');
      const answer=await rl.question('Verification method / 验证方式编号：');
      const method=result.methods[Number(answer)-1];if(!method)throw new CliError('INVALID_2FA_METHOD','Select a listed method.',2);
      await runtime.auth.twoFactor.chooseMethod(method.type);
      const code=await rl.question('Verification code / 验证码：');
      result=await runtime.auth.twoFactor.verify(method.type,code.trim(),options.trustDevice===true);
    }catch(error){await runtime.auth.twoFactor.cancel().catch(()=>{});throw error;}finally{rl.close();}
  }
  return result;
}
