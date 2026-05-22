import { API_ENDPOINTS, DEFAULT_HEADERS, MODELS } from "../constants.js";
import { AuthManager } from "./auth.js";
import { AccountManager } from "./accounts.js";
import { cleanJSONSchemaForAntigravity, sanitizeToolName, deepFilterThinkingBlocks } from "./request-helpers.js";
import { alignTurnBoundaries } from "./recovery.js";

export interface RequestOptions {
  modelId: string;
  projectId: string;
  stream?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  contents: any[];
  tools?: any[];
}

// Map OpenCode contents to Antigravity format
export function transformRequestPayload(options: RequestOptions): any {
  const modelConfig = MODELS[options.modelId] || MODELS["gemini-3.5-flash"];

  // 1. Transform chat contents (users & model turns)
  const rawContents = options.contents.map(turn => {
    const role = turn.role === "assistant" ? "model" : turn.role;
    
    const parts = (turn.parts || []).map((part: any) => {
      if (typeof part === "string") {
        return { text: part };
      }
      if (part && typeof part === "object") {
        if ("text" in part) return { text: part.text };
        if ("functionCall" in part) {
          return {
            functionCall: {
              name: sanitizeToolName(part.functionCall.name),
              args: part.functionCall.args,
              id: part.functionCall.id
            }
          };
        }
        if ("functionResponse" in part) {
          return {
            functionResponse: {
              name: sanitizeToolName(part.functionResponse.name),
              id: part.functionResponse.id,
              response: part.functionResponse.response
            }
          };
        }
      }
      return part;
    });

    return { role, parts };
  });

  // Align turn boundaries to fix any missing tool responses or model/assistant mismatch
  const alignedContents = alignTurnBoundaries(rawContents);

  // Clean thinking blocks from history to prevent signature validation mismatch
  const cleanedContents = deepFilterThinkingBlocks(alignedContents);

  // 2. Format system instructions
  let systemInstruction: any = undefined;
  if (options.systemInstruction) {
    systemInstruction = {
      parts: [{ text: options.systemInstruction }]
    };
  }

  // 3. Format tool definitions
  let toolsPayload: any[] | undefined = undefined;
  if (options.tools && options.tools.length > 0) {
    const declarations = options.tools.map((t: any) => {
      const name = sanitizeToolName(t.name);
      const parameters = cleanJSONSchemaForAntigravity(t.parameters);
      return {
        name,
        description: t.description || "",
        parameters
      };
    });
    toolsPayload = [{ functionDeclarations: declarations }];
  }

  // 4. Build generation config with thinking properties if supported
  const generationConfig: Record<string, any> = {
    temperature: options.temperature ?? 0.7,
    maxOutputTokens: options.maxOutputTokens ?? 4096
  };

  if (modelConfig.thinking.supported) {
    generationConfig.thinkingConfig = {
      thinkingBudget: modelConfig.thinking.maxBudget ?? 8000,
      includeThoughts: true
    };
    // Include thinking level for Gemini 3.5 models
    if (options.modelId.startsWith("gemini-3.5")) {
      generationConfig.thinkingLevel = modelConfig.thinking.defaultLevel || "minimal";
    }
  }

  // Wrap inside Antigravity structure
  return {
    project: options.projectId || "antigravity",
    model: options.modelId,
    request: {
      contents: cleanedContents,
      systemInstruction,
      generationConfig,
      tools: toolsPayload
    },
    userAgent: "antigravity",
    requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  };
}

export interface GroundingCitation {
  title?: string;
  url: string;
  snippet?: string;
}

export interface ParsedChunk {
  text?: string;
  thought?: string;
  functionCall?: {
    name: string;
    args: any;
    id?: string;
  };
  citations?: GroundingCitation[];
}

export class AntigravityClient {
  private accountManager: AccountManager;

  constructor() {
    this.accountManager = AccountManager.getInstance();
  }

  // Execute request with automatic fallback endpoint switching and account rotation on 429
  public async sendRequest(options: RequestOptions): Promise<Response> {
    const payload = transformRequestPayload(options);
    let retryCount = 0;
    const maxRetries = Math.max(1, this.accountManager.getProfiles().length);
    let lastError: Error | null = null;

    while (retryCount < maxRetries) {
      const email = this.accountManager.getActiveEmail();
      const token = await this.accountManager.getActiveAccessToken();

      const isStream = options.stream ?? true;
      const actionPath = isStream 
        ? "/v1internal:streamGenerateContent?alt=sse" 
        : "/v1internal:generateContent";

      const endpoints = [
        API_ENDPOINTS.PRIMARY,
        API_ENDPOINTS.SANDBOX_DAILY,
        API_ENDPOINTS.PRODUCTION
      ];

      let status429OrOverage = false;

      for (const baseUrl of endpoints) {
        try {
          const url = `${baseUrl}${actionPath}`;
          
          const headers: Record<string, string> = {
            ...DEFAULT_HEADERS,
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          };

          if (isStream) {
            headers["Accept"] = "text/event-stream";
          }

          const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
          });

          // Check for rate limit (429) or overage issues (403/429 with specific messaging)
          if (res.status === 429 || (res.status === 403 && await this.isOverageError(res))) {
            status429OrOverage = true;
            throw new Error(`Rate limit or overage on ${email}`);
          }

          if (!res.ok) {
            const bodyText = await res.text();
            throw new Error(`HTTP ${res.status} from ${baseUrl}: ${bodyText}`);
          }

          return res; // Success!
        } catch (err: any) {
          console.warn(`Request failed on endpoint ${baseUrl} with account ${email}:`, err.message || err);
          lastError = err;
          if (status429OrOverage) {
            break; // Break the endpoint loop to rotate account
          }
        }
      }

      if (status429OrOverage && email) {
        console.warn(`Account ${email} hit 429/overage. Rotating...`);
        this.accountManager.markRateLimited(email);
        const rotated = this.accountManager.rotateAccount();
        if (!rotated) {
          break; // No other accounts available
        }
        retryCount++;
      } else {
        // If it was a non-429 error, throw it or let it fail
        throw new Error(`All Antigravity endpoints failed. Last error: ${lastError?.message}`);
      }
    }

    throw new Error(`All authenticated accounts are rate-limited or exhausted. Last error: ${lastError?.message}`);
  }

  private async isOverageError(response: Response): Promise<boolean> {
    try {
      // Clone response to avoid consuming the body
      const clone = response.clone();
      const text = await clone.text();
      return text.toLowerCase().includes("overage") || 
             text.toLowerCase().includes("quota") || 
             text.toLowerCase().includes("limit");
    } catch {
      return false;
    }
  }

  // Parse SSE stream responses
  public async handleStream(
    response: Response, 
    onChunk: (chunk: ParsedChunk) => void
  ): Promise<void> {
    const body = response.body;
    if (!body) {
      throw new Error("Response body is not readable");
    }

    let buffer = "";
    const decoder = new TextDecoder("utf-8");

    // Retrieve reader for stream
    const reader = body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === "[DONE]") continue;

          try {
            const data = JSON.parse(jsonStr);
            const parsedChunk = this.parseAPIChunk(data);
            if (parsedChunk) {
              onChunk(parsedChunk);
            }
          } catch (e) {
            // Ignore JSON parsing errors for partial/malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Extract content parts, thoughts, and citations
  public parseAPIChunk(data: any): ParsedChunk | null {
    const candidate = data?.candidates?.[0];
    if (!candidate) return null;

    const parts = candidate.content?.parts;
    const groundingMetadata = candidate.groundingMetadata;
    const chunkResult: ParsedChunk = {};

    // Process content parts
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (!part) continue;

        // 1. Extract raw thinking block
        if (part.thought === true || part.thoughtSignature || part.thoughtText) {
          chunkResult.thought = part.thoughtText || part.text;
        } 
        // 2. Extract function calls
        else if (part.functionCall) {
          chunkResult.functionCall = {
            name: part.functionCall.name,
            args: part.functionCall.args,
            id: part.functionCall.id
          };
        } 
        // 3. Extract text output
        else if (typeof part.text === "string") {
          chunkResult.text = part.text;
        }
      }
    }

    // Process search citations (Grounding)
    if (groundingMetadata && Array.isArray(groundingMetadata.groundingChunks)) {
      const citations: GroundingCitation[] = [];
      for (const chunk of groundingMetadata.groundingChunks) {
        const web = chunk?.web;
        if (web && web.uri) {
          citations.push({
            title: web.title,
            url: web.uri,
            snippet: web.snippet
          });
        }
      }
      if (citations.length > 0) {
        chunkResult.citations = citations;
      }
    }

    return chunkResult;
  }
}
