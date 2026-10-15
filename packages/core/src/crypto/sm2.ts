/**
 * sm-crypto 是 CJS 老包，两种运行环境的模块形态互不相同，取值必须「链式探测」：
 *  - Node22 ESM：无具名导出（cjs-module-lexer 解不出 module.exports 对象字面量），
 *    命名空间 = { default: module.exports }；
 *  - Vite 预打包：产物只有 `export default require_src()`，且 `import * as` 会被
 *    interopNamespace 包成 `{ ...ns, default: ns }`（.default 指回命名空间自身）——
 *    直接取 .default 或解构都拿不到 sm2。
 * 2026-10-15 事故留档：曾把具名导入改成默认导入解构，Vite 侧拿到命名空间对象 →
 * sm2 = undefined → encryptPassword 抛 TypeError，卡在登录 POST 之前（「登录失败」
 * 表象），并连带打坏 CAS 登录链。故此处改为沿 .default 链逐层探测，直到找到
 * 真正带 sm2.doEncrypt 的那一层。
 */
import * as smCryptoNS from "sm-crypto";

interface Sm2Like {
  doEncrypt: (msg: string, key: string, cipherMode?: number) => string;
  doDecrypt: (msg: string, key: string, cipherMode?: number) => string;
  generateKeyPairHex: () => { publicKey: string; privateKey: string };
  doSignature: (msg: string, privateKey: string, opts?: { hash?: boolean }) => string;
  doVerifySignature: (msg: string, signHex: string, publicKey: string, opts?: { hash?: boolean }) => boolean;
}
interface SmCryptoShape {
  sm2: Sm2Like;
  sm3: unknown;
  sm4: unknown;
}

/** 沿 .default 链探测真正的模块本体（Node ESM / Vite 各种互操作形态通吃） */
function pickSmCrypto(mod: unknown): SmCryptoShape {
  let cur: unknown = mod;
  for (let depth = 0; depth < 5 && cur; depth++) {
    const cand = cur as { sm2?: Partial<Sm2Like>; default?: unknown };
    if (cand.sm2 && typeof cand.sm2.doEncrypt === "function") return cand as SmCryptoShape;
    cur = cand.default;
  }
  throw new Error("sm-crypto 互操作形态未识别（拿不到 sm2.doEncrypt）");
}

const { sm2, sm3, sm4 } = pickSmCrypto(smCryptoNS);

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
