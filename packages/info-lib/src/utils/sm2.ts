/**
 * SM2 密码端口（OneTHU 适配层，非上游代码）。
 *
 * 背景：上游 MIT 边界（06dc3cf0）的登录链发明的仍是明文 i_pass；SM2 加密
 * 是上游切换 BSL 1.1 之后（2024-07-12）才进库的，不可复制。OneTHU 早于本
 * 移植已在自己 reverse-engineer 的 webvpn-poc 移植（packages/core/src/auth/
 * demoLogin.ts + crypto/sm2.ts）中实现了同等的页面公钥提取与加密，本文件把
 * 该能力以注入端口的形式提供给 vendored lib（加密器由 app 层注入
 * @onethu/core 的 encryptPassword）。
 *
 * 公钥提取规则与 demoLogin 同款：只认纯 hex 长串——页面 JS 代码里也含
 * "sm2publicKey" 字样，宽松正则会先撞上 JS 行抓到垃圾（曾致 sm-crypto 崩溃）。
 */

export type Sm2Encryptor = (password: string, publicKeyHex: string) => string;

let encryptor: Sm2Encryptor | null = null;

/** app 启动时注入（@onethu/core crypto/sm2 的 encryptPassword） */
export const setSm2Encryptor = (fn: Sm2Encryptor): void => {
    encryptor = fn;
};

const PUBKEY_RE = /id="sm2publicKey"[^>]*>\s*([0-9a-fA-F]{100,})\s*</;

/** 从登录表单页 HTML 提取公钥并加密密码；页面无公钥或未注入加密器时
 *  回退明文（= 上游边界原行为，兼容旧形态服务端）。 */
export const sm2Pass = (pageHtml: string, password: string): string => {
    if (!encryptor) return password;
    const key = PUBKEY_RE.exec(pageHtml)?.[1]?.trim();
    return key ? encryptor(password, key) : password;
};
