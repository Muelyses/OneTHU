/**
 * 请求体序列化（零依赖模块：不 import Tauri/core/React，测试可直连）。
 *
 * 为什么单独成文件（R21c 真机定案）：nativeFetch 与 tauriFetch 曾各写一份 body 处理，
 * FormData 只在 tauriFetch 里被支持过。网络学堂专线（learnHttp）全部请求走 nativeFetch，
 * 于是作业提交的 FormData 落到 `String(body)`，实际发出字面量 "[object FormData]"、
 * 也不带 multipart 的 Content-Type —— learn 的 Tomcat 直接回
 * 400「Required String parameter 'xszyid' is not present」。
 * 现在**唯一真源**在这里，两个包装都必须调用它。
 */

export async function serializeFormData(
  fd: FormData,
): Promise<{ textBody: string | null; b64Body: string | null; contentType: string }> {
  const boundary =
    "----onethuForm" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  const enc = new TextEncoder();
  type Chunk = string | Uint8Array;
  const chunks: Chunk[] = [];
  let hasFile = false;
  for (const [name, value] of fd.entries()) {
    const disp = `Content-Disposition: form-data; name="${name}"`;
    if (typeof value === "string") {
      chunks.push(`--${boundary}\r\n${disp}\r\n\r\n${value}\r\n`);
    } else {
      hasFile = true;
      const fileName = (value instanceof File && value.name ? value.name : "blob").replace(
        /[\r\n"]/g,
        "_",
      );
      const mime = value instanceof File && value.type ? value.type : "application/octet-stream";
      chunks.push(`--${boundary}\r\n${disp}; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`);
      chunks.push(new Uint8Array(await value.arrayBuffer()));
      chunks.push("\r\n");
    }
  }
  chunks.push(`--${boundary}--\r\n`);
  const contentType = `multipart/form-data; boundary=${boundary}`;
  if (!hasFile) {
    return { textBody: chunks.join(""), b64Body: null, contentType };
  }
  const byteChunks = chunks.map((c) => (typeof c === "string" ? enc.encode(c) : c));
  const total = byteChunks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of byteChunks) {
    out.set(b, off);
    off += b.length;
  }
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < out.length; i += CHUNK) {
    const sub = Array.from(out.subarray(i, Math.min(i + CHUNK, out.length)));
    bin += String.fromCharCode(...sub);
  }
  return { textBody: null, b64Body: btoa(bin), contentType };
}

/** 请求体序列化的单一真源：string / URLSearchParams / FormData / Uint8Array。
 *  nativeFetch 与 tauriFetch 都必须经此——两个包装此前各写一份，FormData 只补在了
 *  tauriFetch 上，网络学堂（走 nativeFetch）的作业提交因此长期 400（R21c 真机定案）。 */
export async function serializeFetchBody(body: unknown): Promise<{
  bodyStr: string | null;
  bodyB64: string | null;
  contentType: string | null;
}> {
  if (body == null) return { bodyStr: null, bodyB64: null, contentType: null };
  if (typeof body === "string") return { bodyStr: body, bodyB64: null, contentType: null };
  if (body instanceof URLSearchParams) {
    return {
      bodyStr: body.toString(),
      bodyB64: null,
      contentType: "application/x-www-form-urlencoded;charset=UTF-8",
    };
  }
  if (body instanceof FormData) {
    const s = await serializeFormData(body);
    return s.textBody !== null
      ? { bodyStr: s.textBody, bodyB64: null, contentType: s.contentType }
      : { bodyStr: null, bodyB64: s.b64Body ?? null, contentType: s.contentType };
  }
  if (body instanceof Uint8Array) {
    // 二进制不能过 invoke 的 UTF-8 字符串通道（0x89 等会被损成 U+FFFD）→ base64
    let bin = "";
    for (let i = 0; i < body.length; i += 0x8000) {
      bin += String.fromCharCode(...body.subarray(i, i + 0x8000));
    }
    return { bodyStr: null, bodyB64: btoa(bin), contentType: null };
  }
  // 其余类型（含未知对象）保持旧语义：字符串化。
  // 不在此处 import 日志模块（会让本模块拖进 core 的依赖，测试无法直连）。
  return { bodyStr: String(body), bodyB64: null, contentType: null };
}
