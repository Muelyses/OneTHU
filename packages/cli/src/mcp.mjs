import { CliError, errorPayload, MAX_REQUEST_BYTES } from "./client.mjs";

/** A transparent stdio adapter; local service authorization remains in OneTHU.
 * stdout is exclusively newline-delimited JSON-RPC, including protocol errors. */
export async function proxyMcp(client, { stdin, stdout, stderr }) {
  const tasks = new Set();
  const emit = (message) => stdout.write(`${JSON.stringify(message)}\n`);
  const rpcError = (id, code, message, data) => emit({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
  const forward = async (line) => {
    let message;
    try { message = JSON.parse(line); } catch {
      rpcError(null, -32700, "Invalid JSON input.");
      return;
    }
    const validId = (id) => typeof id === "string" || typeof id === "number" && Number.isFinite(id) || id === null;
    if (!message || Array.isArray(message) || message.jsonrpc !== "2.0"
      || !(typeof message.method === "string" || Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))
      || Object.hasOwn(message, "id") && !validId(message.id)) {
      rpcError(null, -32600, "Expected a JSON-RPC 2.0 object.");
      return;
    }
    const hasId = Object.hasOwn(message, "id");
    try {
      if (message.method === "initialize" && typeof message.params?.protocolVersion === "string") {
        client.mcpProtocol = message.params.protocolVersion;
      }
      const response = await client.post("/mcp", message);
      if (!response.text.trim()) {
        if (hasId) throw new CliError("INVALID_RESPONSE", "The local MCP service returned no response to a request.", 3);
        return;
      }
      const frames = response.contentType.includes("text/event-stream")
        ? response.text.replace(/\r\n/g, "\n").split(/\n\n/).map((event) => event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n")).filter(Boolean)
        : [response.text];
      let matched = !hasId;
      const envelopes = [];
      for (const frame of frames) {
        let envelope;
        try { envelope = JSON.parse(frame); } catch { throw new CliError("INVALID_RESPONSE", "The local MCP service returned an invalid JSON message.", 3); }
        if (!envelope || envelope.jsonrpc !== "2.0" || Array.isArray(envelope)
          || !(typeof envelope.method === "string" || Object.hasOwn(envelope, "result") || Object.hasOwn(envelope, "error"))) {
          throw new CliError("INVALID_RESPONSE", "The local MCP service returned an invalid JSON-RPC envelope.", 3);
        }
        if (Object.hasOwn(envelope, "result") || Object.hasOwn(envelope, "error")) {
          if (!hasId || envelope.id !== message.id) throw new CliError("INVALID_RESPONSE", "The local MCP response did not match the request ID.", 3);
          matched = true;
        }
        if (message.method === "initialize" && typeof envelope.result?.protocolVersion === "string") client.mcpProtocol = envelope.result.protocolVersion;
        envelopes.push(envelope);
      }
      if (!matched) throw new CliError("INVALID_RESPONSE", "The local MCP response did not match the request ID.", 3);
      for (const envelope of envelopes) emit(envelope);
    } catch (error) {
      const payload = errorPayload(error).error;
      if (hasId) rpcError(message.id, -32000, payload.message, { code: payload.code });
      stderr.write(`${JSON.stringify({ error: payload })}\n`);
    }
  };
  let buffer = "";
  stdin.setEncoding("utf8");
  try {
    for await (const chunk of stdin) {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        if (Buffer.byteLength(line) > MAX_REQUEST_BYTES) throw new CliError("REQUEST_TOO_LARGE", "MCP input exceeds the 1 MiB message limit.", 2);
        if (tasks.size >= 32) await Promise.race(tasks);
        const task = forward(line);
        tasks.add(task);
        void task.finally(() => tasks.delete(task));
      }
      if (Buffer.byteLength(buffer) > MAX_REQUEST_BYTES) throw new CliError("REQUEST_TOO_LARGE", "MCP input exceeds the 1 MiB message limit.", 2);
    }
    if (buffer.trim()) await forward(buffer.trim());
    await Promise.all(tasks);
    return 0;
  } catch (error) {
    await Promise.allSettled(tasks);
    stderr.write(`${JSON.stringify(errorPayload(error))}\n`);
    return error instanceof CliError ? error.exitCode : 1;
  }
}
