/**
 * SM2 国密封装（选课系统 / CAS 登录密码加密）。
 * 密文格式：'04' + C1C3C2 hex，sm-crypto cipherMode=1 —— 与服务端验证一致。
 */
// sm-crypto 是 CJS 老包：Node22 ESM 具名导入解不出（cjs-module-lexer 失败），改走默认导入解构（sm2 实际只用到 sm2）
import smCryptoPkg from "sm-crypto";
const { sm2, sm3, sm4 } = smCryptoPkg as { sm2: any; sm3: any; sm4: any };

/** CAS / 教务登录口令加密：公钥来自登录页 #sm2publicKey */
export function encryptPassword(password: string, publicKey: string): string {
  // WebVPN 登录页的公钥自带 "04" 前缀（128 hex），直连 CAS 页不带（126 hex）——统一归一
  const key = /^04[0-9a-fA-F]+$/.test(publicKey) && publicKey.length % 2 === 0 && publicKey.length >= 126
    ? publicKey
    : "04" + publicKey;
  return "04" + sm2.doEncrypt(password, key, 1);
}

export function decrypt(cipherHexWith04: string, privateKey: string): string {
  return sm2.doDecrypt(cipherHexWith04.replace(/^04/, ""), privateKey, 1);
}

export function generateKeyPair(): { publicKey: string; privateKey: string } {
  return sm2.generateKeyPairHex();
}

export function sign(msg: string, privateKey: string): string {
  return sm2.doSignature(msg, privateKey, { hash: true });
}

export function verify(msg: string, signHex: string, publicKey: string): boolean {
  return sm2.doVerifySignature(msg, signHex, publicKey, { hash: true });
}

export { sm2, sm3, sm4 };
