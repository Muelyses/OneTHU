import http from "node:http";

export const DEFAULT_ENDPOINT = "http://127.0.0.1:8787";
export const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 1024 * 1024;
const GENERIC_ERROR_PREFIXES = new Set(["HTTP", "HTTPS", "ERROR", "ERR", "API", "RPC", "JSON", "JSONRPC", "WARNING", "FATAL", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export class CliError extends Error {
  constructor(code, message, exitCode = 1, details) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function errorPayload(error) {
  const known = error instanceof CliError;
  return { error: {
    code: known ? error.code : "CLIENT_ERROR",
    message: known ? error.message : "OneTHU CLI encountered an unexpected local error.",
    ...(known && error.details !== undefined ? { details: error.details } : {}),
  } };
}

/** Accept canonical loopback only. Pin localhost to 127.0.0.1, so DNS/proxies
 * cannot turn a local service command into a request to another computer. */
export function parseEndpoint(value = DEFAULT_ENDPOINT) {
  if (typeof value !== "string" || !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::[1-9]\d{0,4})?\/?$/.test(value)) {
    throw new CliError("INVALID_ENDPOINT", "Endpoint must be an HTTP loopback origin, for example http://127.0.0.1:8787 (no credentials, path, query or fragment).", 2);
  }
  let url;
  try { url = new URL(value); } catch {
    throw new CliError("INVALID_ENDPOINT", "The loopback endpoint has an invalid port.", 2);
  }
  return { origin: url.origin, hostname: url.hostname === "[::1]" ? "::1" : "127.0.0.1", port: Number(url.port || 80) };
}

export function parseTimeout(value = DEFAULT_TIMEOUT_MS) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 600_000) {
    throw new CliError("INVALID_TIMEOUT", "--timeout must be an integer between 1 and 600000 milliseconds.", 2);
  }
  return Number(value);
}

function safeServerMessage(text, fallback) {
  // Never repeat an HTML document or full HTTP body in terminal diagnostics.
  if (typeof text !== "string" || /<\/?(?:html|body|script)\b/i.test(text)) return fallback;
  return text.slice(0, 1500)
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/((?:token|ticket|password|cookie|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]");
}

export class LocalClient {
  constructor({ endpoint = DEFAULT_ENDPOINT, timeout = DEFAULT_TIMEOUT_MS } = {}) {
    this.endpoint = parseEndpoint(endpoint);
    this.timeout = parseTimeout(timeout);
    this.sequence = 0;
    this.mcpSession = "";
    this.mcpProtocol = "";
  }

  async post(path, message) {
    if (path !== "/cli/v1" && path !== "/mcp") throw new CliError("INVALID_PATH", "Unsupported local service path.", 2);
    const data = JSON.stringify(message);
    if (Buffer.byteLength(data) > MAX_REQUEST_BYTES) throw new CliError("REQUEST_TOO_LARGE", "Request exceeds the 1 MiB local service limit.", 2);
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "Content-Length": Buffer.byteLength(data) };
    if (path === "/mcp") {
      if (this.mcpSession) headers["Mcp-Session-Id"] = this.mcpSession;
      if (this.mcpProtocol) headers["MCP-Protocol-Version"] = this.mcpProtocol;
    }
    return new Promise((resolve, reject) => {
      let completed = false;
      let timer;
      const finish = (error, result) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(result);
      };
      const request = http.request({
        hostname: this.endpoint.hostname, port: this.endpoint.port, path, method: "POST", headers,
        agent: false,
      }, (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.destroy();
          finish(new CliError("REDIRECT_REFUSED", "The local service returned a redirect. OneTHU CLI only talks to the configured loopback service.", 3, { status }));
          return;
        }
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            response.destroy();
            finish(new CliError("RESPONSE_TOO_LARGE", "Local service response exceeds 16 MiB; use paginated operations.", 3));
          } else chunks.push(chunk);
        });
        response.on("error", () => finish(new CliError("CONNECTION_INTERRUPTED", "The OneTHU app closed the local connection before the response was complete.", 3)));
        response.on("aborted", () => finish(new CliError("CONNECTION_INTERRUPTED", "The OneTHU app closed the local connection before the response was complete.", 3)));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (status < 200 || status >= 300) {
            const hint = status === 403
              ? "Open the signed-in OneTHU app and enable its local CLI/MCP service in OH settings. Check the app's authorization notice."
              : `The local OneTHU service returned HTTP ${status}.`;
            finish(new CliError(status === 403 ? "LOCAL_SERVICE_DISABLED" : "HTTP_ERROR", hint, 3, { status }));
            return;
          }
          if (path === "/mcp" && response.headers["mcp-session-id"]) this.mcpSession = String(response.headers["mcp-session-id"]);
          finish(null, { status, text, contentType: String(response.headers["content-type"] ?? "") });
        });
      });
      timer = setTimeout(() => {
        finish(new CliError("TIMEOUT", "The local OneTHU service did not finish in time. Check the app for a confirmation prompt or network error.", 3, { timeoutMs: this.timeout }));
        request.destroy();
      }, this.timeout);
      request.on("error", () => finish(new CliError("CONNECTION_FAILED", "Cannot reach OneTHU. Start the desktop app, sign in, and enable its local CLI/MCP service in OH settings.", 3)));
      request.end(data);
    });
  }

  async call(method, params = {}) {
    const id = ++this.sequence;
    // Share the transport budget with the app, including time spent awaiting
    // approval. Leave room for a partial result before the socket times out.
    const budget = Math.min(this.timeout, 150_000);
    const margin = Math.min(2_000, Math.floor(budget / 10));
    const requestParams = method === "service/call"
      ? { ...params, deadlineUnixMs: Date.now() + Math.max(1, budget - margin) }
      : params;
    const response = await this.post("/cli/v1", { jsonrpc: "2.0", id, method, params: requestParams });
    let result;
    try { result = JSON.parse(response.text); } catch {
      throw new CliError("INVALID_RESPONSE", "The local service returned an invalid JSON response. Update OneTHU and the CLI together.", 3);
    }
    if (!result || result.jsonrpc !== "2.0" || result.id !== id || (Object.hasOwn(result, "result") === Object.hasOwn(result, "error"))) {
      throw new CliError("INVALID_RESPONSE", "The local service returned an invalid JSON-RPC response.", 3);
    }
    if (Object.hasOwn(result, "error")) {
      const error = result.error;
      const code = error?.data?.code ?? error?.data?.details?.code ?? error?.details?.code;
      const message = safeServerMessage(error?.message, "The OneTHU operation failed. Check its session, permissions, and app confirmation.");
      const prefix = /^([A-Z][A-Z0-9_]{2,63})(?::|\b)/.exec(message)?.[1];
      const fallbackCode = prefix && !GENERIC_ERROR_PREFIXES.has(prefix) ? prefix : "SERVICE_ERROR";
      throw new CliError(typeof code === "string" && /^[A-Za-z0-9_-]+$/.test(code) ? code : fallbackCode,
        message, 4,
        { rpcCode: error?.code ?? null });
    }
    return result.result;
  }
}
