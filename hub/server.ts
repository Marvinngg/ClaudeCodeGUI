import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  getActiveProviders,
  getAllProviders,
  getProviderById,
  createProvider,
  updateProvider,
  deleteProvider,
  getAllMcpServers,
  getMcpServerById,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  getAllSystemPrompts,
  getAllSharedSkills,
  getSharedSkillById,
  createOrUpdateSharedSkill,
  deleteSharedSkill,
  getAllSharedTemplates,
  getSharedTemplateById,
  createOrUpdateSharedTemplate,
  deleteSharedTemplate,
  getAllSharedPrompts,
  getSharedPromptById,
  createOrUpdateSharedPrompt,
  deleteSharedPrompt,
  getAllSharedConversations,
  getSharedConversationById,
  createSharedConversation,
  deleteSharedConversation,
  recordUsage,
  getUsageStats,
  getSetting,
  setSetting,
  getAllSettings,
  closeDatabase,
} from "./db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = parseInt(process.env.PORT ?? "3100", 10);
const VERSION = "0.1.0";

/** Read the full request body and parse it as JSON. */
function readJsonBody<T = unknown>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw.length > 0 ? JSON.parse(raw) : ({} as T));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** Send a JSON response with the given status code. */
function json(res: http.ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/** Send a simple 404 / 405 error. */
function notFound(res: http.ServerResponse): void {
  json(res, 404, { error: "Not found" });
}

function methodNotAllowed(res: http.ServerResponse): void {
  json(res, 405, { error: "Method not allowed" });
}

/** Extract a numeric id from a path segment like "/api/admin/providers/42". */
function extractTrailingId(pathname: string): number | null {
  const parts = pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  const n = Number(last);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Serve static files from the public directory. */
function serveStaticFile(res: http.ServerResponse, filepath: string): void {
  const ext = path.extname(filepath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };

  const contentType = mimeTypes[ext] || "application/octet-stream";

  fs.readFile(filepath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
    });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsedUrl = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";
  const method = (req.method ?? "GET").toUpperCase();

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  // ----- Health -----
  if (pathname === "/api/health") {
    json(res, 200, { status: "ok", version: VERSION });
    return;
  }

  // ----- Sync: config -----
  if (pathname === "/api/sync/config") {
    if (method !== "GET") return methodNotAllowed(res);
    const providers = getActiveProviders();
    const mcpServers = getAllMcpServers();
    const systemPrompts = getAllSystemPrompts();
    const sharedSkills = getAllSharedSkills();
    const templates = getAllSharedTemplates();
    const sharedPrompts = getAllSharedPrompts();
    json(res, 200, { providers, mcpServers, systemPrompts, sharedSkills, templates, sharedPrompts });
    return;
  }

  // ----- Usage: report -----
  if (pathname === "/api/usage/report") {
    if (method !== "POST") return methodNotAllowed(res);
    try {
      const body = await readJsonBody<Record<string, unknown>>(req);
      const record = recordUsage({
        user_id: String(body.userId ?? body.user_id ?? ""),
        session_id: String(body.sessionId ?? body.session_id ?? ""),
        model: String(body.model ?? ""),
        input_tokens: Number(body.inputTokens ?? body.input_tokens ?? 0),
        output_tokens: Number(body.outputTokens ?? body.output_tokens ?? 0),
        cost_usd: Number(body.costUsd ?? body.cost_usd ?? 0),
      });
      json(res, 201, { ok: true, record });
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
    }
    return;
  }

  // ----- Admin: usage -----
  if (pathname === "/api/admin/usage") {
    if (method !== "GET") return methodNotAllowed(res);
    const userId = parsedUrl.searchParams.get("user_id") ?? undefined;
    const stats = getUsageStats(userId);
    json(res, 200, stats);
    return;
  }

  // ----- Admin: providers -----
  if (pathname === "/api/admin/providers") {
    if (method === "GET") {
      json(res, 200, getAllProviders());
      return;
    }
    if (method === "POST") {
      try {
        const body = await readJsonBody<Record<string, unknown>>(req);
        // If an id is supplied, treat as update; otherwise create.
        if (body.id && Number(body.id) > 0) {
          const updated = updateProvider(Number(body.id), {
            name: body.name as string | undefined,
            provider_type: body.provider_type as string | undefined,
            base_url: body.base_url as string | undefined,
            api_key: body.api_key as string | undefined,
            extra_env: body.extra_env as string | undefined,
            notes: body.notes as string | undefined,
            is_active: body.is_active != null ? Number(body.is_active) : undefined,
          });
          if (!updated) {
            json(res, 404, { error: "Provider not found" });
          } else {
            json(res, 200, updated);
          }
        } else {
          const created = createProvider({
            name: String(body.name ?? ""),
            provider_type: String(body.provider_type ?? "anthropic"),
            base_url: String(body.base_url ?? ""),
            api_key: String(body.api_key ?? ""),
            extra_env: String(body.extra_env ?? "{}"),
            notes: String(body.notes ?? ""),
            is_active: body.is_active != null ? Number(body.is_active) : 1,
          });
          json(res, 201, created);
        }
      } catch {
        json(res, 400, { error: "Invalid JSON body" });
      }
      return;
    }
    return methodNotAllowed(res);
  }

  // DELETE /api/admin/providers/:id
  if (pathname.startsWith("/api/admin/providers/") && method === "DELETE") {
    const id = extractTrailingId(pathname);
    if (!id) return notFound(res);
    const deleted = deleteProvider(id);
    json(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: "Provider not found" });
    return;
  }

  // GET single provider /api/admin/providers/:id
  if (pathname.startsWith("/api/admin/providers/") && method === "GET") {
    const id = extractTrailingId(pathname);
    if (!id) return notFound(res);
    const provider = getProviderById(id);
    if (!provider) return json(res, 404, { error: "Provider not found" });
    json(res, 200, provider);
    return;
  }

  // ----- Admin: MCP servers -----
  if (pathname === "/api/admin/mcp") {
    if (method === "GET") {
      json(res, 200, getAllMcpServers());
      return;
    }
    if (method === "POST") {
      try {
        const body = await readJsonBody<Record<string, unknown>>(req);
        if (body.id && Number(body.id) > 0) {
          const updated = updateMcpServer(Number(body.id), {
            name: body.name as string | undefined,
            config: body.config != null
              ? (typeof body.config === "string" ? body.config : JSON.stringify(body.config))
              : undefined,
            description: body.description as string | undefined,
            publisher: body.publisher as string | undefined,
          });
          if (!updated) {
            json(res, 404, { error: "MCP server not found" });
          } else {
            json(res, 200, updated);
          }
        } else {
          const created = createMcpServer({
            name: String(body.name ?? ""),
            config: body.config != null
              ? (typeof body.config === "string" ? body.config : JSON.stringify(body.config))
              : "{}",
            description: String(body.description ?? ""),
            publisher: String(body.publisher ?? ""),
          });
          json(res, 201, created);
        }
      } catch {
        json(res, 400, { error: "Invalid JSON body" });
      }
      return;
    }
    return methodNotAllowed(res);
  }

  // DELETE /api/admin/mcp/:id
  if (pathname.startsWith("/api/admin/mcp/") && method === "DELETE") {
    const id = extractTrailingId(pathname);
    if (!id) return notFound(res);
    const deleted = deleteMcpServer(id);
    json(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: "MCP server not found" });
    return;
  }

  // GET single MCP server /api/admin/mcp/:id
  if (pathname.startsWith("/api/admin/mcp/") && method === "GET") {
    const id = extractTrailingId(pathname);
    if (!id) return notFound(res);
    const mcp = getMcpServerById(id);
    if (!mcp) return json(res, 404, { error: "MCP server not found" });
    json(res, 200, mcp);
    return;
  }

  // ----- Shared Skills -----
  if (pathname === "/api/shared/skills") {
    if (method === "GET") {
      json(res, 200, getAllSharedSkills());
      return;
    }
    if (method === "POST") {
      try {
        const body = await readJsonBody<Record<string, unknown>>(req);
        const skill = createOrUpdateSharedSkill({
          name: String(body.name ?? ""),
          content: String(body.content ?? ""),
          description: String(body.description ?? ""),
          publisher: String(body.publisher ?? ""),
        });
        json(res, 201, skill);
      } catch {
        json(res, 400, { error: "Invalid JSON body" });
      }
      return;
    }
    return methodNotAllowed(res);
  }

  // DELETE /api/shared/skills/:id
  if (pathname.startsWith("/api/shared/skills/") && method === "DELETE") {
    const id = extractTrailingId(pathname);
    if (!id) return notFound(res);
    const deleted = deleteSharedSkill(id);
    json(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: "Skill not found" });
    return;
  }

  // GET single skill /api/shared/skills/:id
  if (pathname.startsWith("/api/shared/skills/") && method === "GET") {
    const id = extractTrailingId(pathname);
    if (!id) return notFound(res);
    const skill = getSharedSkillById(id);
    if (!skill) return json(res, 404, { error: "Skill not found" });
    json(res, 200, skill);
    return;
  }

  // ----- Shared Templates -----
  if (pathname === "/api/shared/templates") {
    if (method === "GET") {
      json(res, 200, getAllSharedTemplates());
      return;
    }
    if (method === "POST") {
      try {
        const body = await readJsonBody<Record<string, unknown>>(req);
        const template = createOrUpdateSharedTemplate({
          name: String(body.name ?? ""),
          content: String(body.content ?? ""),
          description: String(body.description ?? ""),
          publisher: String(body.publisher ?? ""),
          template_type: String(body.template_type ?? "claude_md"),
        });
        json(res, 201, template);
      } catch {
        json(res, 400, { error: "Invalid JSON body" });
      }
      return;
    }
    return methodNotAllowed(res);
  }

  // DELETE /api/shared/templates/:id
  if (pathname.startsWith("/api/shared/templates/") && method === "DELETE") {
    const id = extractTrailingId(pathname);
    if (!id) return notFound(res);
    const deleted = deleteSharedTemplate(id);
    json(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: "Template not found" });
    return;
  }

  // GET single template /api/shared/templates/:id
  if (pathname.startsWith("/api/shared/templates/") && method === "GET") {
    const id = extractTrailingId(pathname);
    if (!id) return notFound(res);
    const template = getSharedTemplateById(id);
    if (!template) return json(res, 404, { error: "Template not found" });
    json(res, 200, template);
    return;
  }

  // ----- Shared Prompts -----
  if (pathname === "/api/shared/prompts") {
    if (method === "GET") {
      json(res, 200, getAllSharedPrompts());
      return;
    }
    if (method === "POST") {
      try {
        const body = await readJsonBody<Record<string, unknown>>(req);
        const prompt = createOrUpdateSharedPrompt({
          name: String(body.name ?? ""),
          content: String(body.content ?? ""),
          description: String(body.description ?? ""),
          publisher: String(body.publisher ?? ""),
          tags: String(body.tags ?? ""),
        });
        json(res, 201, prompt);
      } catch {
        json(res, 400, { error: "Invalid JSON body" });
      }
      return;
    }
    return methodNotAllowed(res);
  }

  // DELETE /api/shared/prompts/:id
  if (pathname.startsWith("/api/shared/prompts/") && method === "DELETE") {
    const id = extractTrailingId(pathname);
    if (!id) return notFound(res);
    const deleted = deleteSharedPrompt(id);
    json(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: "Prompt not found" });
    return;
  }

  // GET single prompt /api/shared/prompts/:id
  if (pathname.startsWith("/api/shared/prompts/") && method === "GET") {
    const id = extractTrailingId(pathname);
    if (!id) return notFound(res);
    const prompt = getSharedPromptById(id);
    if (!prompt) return json(res, 404, { error: "Prompt not found" });
    json(res, 200, prompt);
    return;
  }

  // ----- Shared Conversations -----
  if (pathname === "/api/shared/conversations") {
    if (method === "GET") {
      json(res, 200, getAllSharedConversations());
      return;
    }
    if (method === "POST") {
      try {
        const body = await readJsonBody<Record<string, unknown>>(req);
        const conversation = createSharedConversation({
          title: String(body.title ?? ""),
          content: String(body.content ?? ""),
          user_id: String(body.user_id ?? ""),
          description: String(body.description ?? ""),
          tags: String(body.tags ?? ""),
          raw_messages: body.raw_messages ? String(body.raw_messages) : null, // ✅ 传递原始对话
        });
        json(res, 201, conversation);
      } catch {
        json(res, 400, { error: "Invalid JSON body" });
      }
      return;
    }
    return methodNotAllowed(res);
  }

  // DELETE /api/shared/conversations/:id
  if (pathname.startsWith("/api/shared/conversations/") && method === "DELETE") {
    const id = extractTrailingId(pathname);
    if (!id) return notFound(res);
    const deleted = deleteSharedConversation(id);
    json(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: "Conversation not found" });
    return;
  }

  // GET single conversation /api/shared/conversations/:id
  if (pathname.startsWith("/api/shared/conversations/") && method === "GET") {
    const id = extractTrailingId(pathname);
    if (!id) return notFound(res);
    const conversation = getSharedConversationById(id);
    if (!conversation) return json(res, 404, { error: "Conversation not found" });
    json(res, 200, conversation);
    return;
  }

  // ----- Settings -----
  if (pathname === "/api/settings") {
    if (method === "GET") {
      const settings = getAllSettings();
      // Mask API key for security
      if (settings.anthropic_api_key) {
        settings.anthropic_api_key = settings.anthropic_api_key.substring(0, 10) + "...";
      }
      json(res, 200, settings);
      return;
    }
    if (method === "POST") {
      try {
        const body = await readJsonBody<Record<string, unknown>>(req);
        if (body.anthropic_api_key && typeof body.anthropic_api_key === "string") {
          setSetting("anthropic_api_key", body.anthropic_api_key);
        }
        json(res, 200, { ok: true });
      } catch {
        json(res, 400, { error: "Invalid JSON body" });
      }
      return;
    }
    return methodNotAllowed(res);
  }

  // ----- Summarize -----
  if (pathname === "/api/summarize") {
    if (method !== "POST") return methodNotAllowed(res);

    try {
      const body = await readJsonBody<{
        messages: Array<{ role: string; content: string }>;
        summary_type?: "skill" | "template" | "prompt";
      }>(req);

      // Get API key from settings
      const apiKey = getSetting("anthropic_api_key");
      if (!apiKey) {
        json(res, 500, { error: "Anthropic API Key not configured in Hub settings" });
        return;
      }

      const messages = body.messages || [];
      const summaryType = body.summary_type || "prompt";

      // Create Anthropic client
      const client = new Anthropic({ apiKey });

      // Generate summary prompt based on type
      let systemPrompt = "";
      if (summaryType === "skill") {
        systemPrompt = `You are an expert at analyzing conversations and creating skill summaries.
Analyze the conversation and create a skill summary with:
- name: A concise skill name (e.g., "Debug TypeScript API")
- description: A brief 1-2 sentence description
- content: The complete skill implementation or instructions
- tags: Relevant tags (as an array)

Return ONLY valid JSON in this exact format:
{
  "name": "...",
  "description": "...",
  "content": "...",
  "tags": ["tag1", "tag2"]
}`;
      } else if (summaryType === "template") {
        systemPrompt = `You are an expert at analyzing conversations and creating template summaries.
Analyze the conversation and create a template summary with:
- name: A concise template name
- description: A brief 1-2 sentence description
- content: The complete template content
- tags: Relevant tags (as an array)

Return ONLY valid JSON in this exact format:
{
  "name": "...",
  "description": "...",
  "content": "...",
  "tags": ["tag1", "tag2"]
}`;
      } else {
        systemPrompt = `You are an expert at analyzing conversations and creating summaries.
Analyze the conversation and create a summary with:
- name: A concise title (under 60 characters)
- description: A brief 1-2 sentence description
- content: A detailed summary of the conversation (key points, solutions, outcomes)
- tags: Relevant tags (as an array, e.g., ["typescript", "debugging", "api"])

Return ONLY valid JSON in this exact format:
{
  "name": "...",
  "description": "...",
  "content": "...",
  "tags": ["tag1", "tag2"]
}`;
      }

      // Call Claude API
      const response = await client.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Here is the conversation to summarize:\n\n${JSON.stringify(messages, null, 2)}`,
          },
        ],
      });

      // Parse response
      const textContent = response.content.find((c) => c.type === "text");
      if (!textContent || textContent.type !== "text") {
        json(res, 500, { error: "Failed to generate summary" });
        return;
      }

      const summaryText = textContent.text.trim();
      let summary;

      try {
        // Try to parse JSON directly
        summary = JSON.parse(summaryText);
      } catch {
        // If not valid JSON, try to extract JSON from markdown code blocks
        const jsonMatch = summaryText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (jsonMatch) {
          summary = JSON.parse(jsonMatch[1]);
        } else {
          // Last attempt: find any JSON-like object
          const objMatch = summaryText.match(/\{[\s\S]*\}/);
          if (objMatch) {
            summary = JSON.parse(objMatch[0]);
          } else {
            json(res, 500, { error: "Failed to parse summary response" });
            return;
          }
        }
      }

      json(res, 200, summary);
    } catch (err) {
      console.error("[hub] Summarize error:", err);
      json(res, 500, {
        error: err instanceof Error ? err.message : "Failed to generate summary"
      });
    }
    return;
  }

  // ----- Static files -----
  // Serve index.html for root path
  if (pathname === "/" || pathname === "/index.html") {
    const filepath = path.join(PUBLIC_DIR, "index.html");
    serveStaticFile(res, filepath);
    return;
  }

  // Serve settings.html
  if (pathname === "/settings.html") {
    const filepath = path.join(PUBLIC_DIR, "settings.html");
    serveStaticFile(res, filepath);
    return;
  }

  // ----- Fallback -----
  notFound(res);
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error("[hub] Unhandled error:", err);
    if (!res.headersSent) {
      json(res, 500, { error: "Internal server error" });
    }
  });
});

server.listen(PORT, () => {
  console.log(`[CodePilot Hub] v${VERSION} listening on http://localhost:${PORT}`);
});

// Graceful shutdown
function shutdown(): void {
  console.log("\n[CodePilot Hub] Shutting down...");
  server.close(() => {
    closeDatabase();
    console.log("[CodePilot Hub] Goodbye.");
    process.exit(0);
  });
  // Force exit after 5 seconds if connections are still hanging
  setTimeout(() => {
    closeDatabase();
    process.exit(1);
  }, 5000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
