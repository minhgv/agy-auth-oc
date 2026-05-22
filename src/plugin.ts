import { MODELS } from "./constants.js";
import { AntigravityClient } from "./plugin/request.js";

let registered = false;
let originalFetch: typeof globalThis.fetch;

export function registerFetchInterceptor(): void {
  if (registered) return;

  originalFetch = globalThis.fetch;

  globalThis.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    // Only intercept requests targeting Google's generative language API
    if (urlStr.includes("generativelanguage.googleapis.com")) {
      try {
        console.log(`[Antigravity Interceptor] Intercepted request to: ${urlStr}`);

        // 1. Model detail and listing queries
        if (urlStr.includes("/models") && !urlStr.includes(":")) {
          // Model info lookup
          const modelMatch = urlStr.match(/\/models\/(?:antigravity-)?([^:/]+)$/);
          if (modelMatch) {
            const modelId = modelMatch[1];
            const model = MODELS[modelId];
            if (model) {
              return new Response(JSON.stringify({
                name: `models/${model.id}`,
                version: "2.0",
                displayName: model.displayName,
                description: `Antigravity model: ${model.displayName}`,
                inputTokenLimit: model.contextWindow,
                outputTokenLimit: model.outputLimit,
                supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
              }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
              });
            }
          }

          // General Model listing
          const modelsArray = Object.values(MODELS).map(m => ({
            name: `models/${m.id}`,
            version: "2.0",
            displayName: m.displayName,
            description: `Antigravity model: ${m.displayName}`,
            inputTokenLimit: m.contextWindow,
            outputTokenLimit: m.outputLimit,
            supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
          }));

          return new Response(JSON.stringify({ models: modelsArray }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }

        // 2. Chat content generation queries
        if (urlStr.includes(":generateContent") || urlStr.includes(":streamGenerateContent")) {
          // Extract model ID from the path
          const modelMatch = urlStr.match(/\/models\/(?:antigravity-)?([^:/]+):/);
          if (!modelMatch) {
            throw new Error(`Failed to extract model ID from URL: ${urlStr}`);
          }
          const modelId = modelMatch[1];

          // Parse request body
          if (!init || !init.body) {
            throw new Error("Request body is empty");
          }

          const bodyStr = typeof init.body === "string"
            ? init.body
            : new TextDecoder().decode(init.body as any);

          const body = JSON.parse(bodyStr);

          // Flatten tools declarations
          let flatTools: any[] = [];
          if (Array.isArray(body.tools)) {
            for (const tool of body.tools) {
              if (tool.functionDeclarations && Array.isArray(tool.functionDeclarations)) {
                flatTools.push(...tool.functionDeclarations);
              } else {
                flatTools.push(tool);
              }
            }
          }

          const isStream = urlStr.includes(":streamGenerateContent");
          const systemInstruction = body.systemInstruction?.parts?.[0]?.text || body.systemInstruction;

          const options = {
            modelId,
            projectId: process.env.GOOGLE_PROJECT_ID || process.env.GCP_PROJECT_ID || "antigravity",
            stream: isStream,
            temperature: body.generationConfig?.temperature,
            maxOutputTokens: body.generationConfig?.maxOutputTokens,
            systemInstruction,
            contents: body.contents || [],
            tools: flatTools.length > 0 ? flatTools : undefined
          };

          const client = new AntigravityClient();

          if (isStream) {
            const stream = new ReadableStream({
              async start(controller) {
                try {
                  const response = await client.sendRequest(options);
                  await client.handleStream(response, (chunk) => {
                    const parts: any[] = [];

                    if (chunk.thought) {
                      parts.push({
                        text: chunk.thought,
                        thought: true
                      });
                    }

                    if (chunk.text) {
                      parts.push({
                        text: chunk.text
                      });
                    }

                    if (chunk.functionCall) {
                      parts.push({
                        functionCall: {
                          name: chunk.functionCall.name,
                          args: chunk.functionCall.args,
                          id: chunk.functionCall.id
                        }
                      });
                    }

                    const dataPayload: any = {
                      candidates: [
                        {
                          content: {
                            role: "model",
                            parts
                          },
                          index: 0
                        }
                      ]
                    };

                    if (chunk.citations && chunk.citations.length > 0) {
                      dataPayload.candidates[0].groundingMetadata = {
                        groundingChunks: chunk.citations.map(c => ({
                          web: {
                            uri: c.url,
                            title: c.title,
                            snippet: c.snippet
                          }
                        }))
                      };
                    }

                    const sseString = `data: ${JSON.stringify(dataPayload)}\n\n`;
                    controller.enqueue(new TextEncoder().encode(sseString));
                  });

                  controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                  controller.close();
                } catch (err: any) {
                  console.error("[Antigravity Interceptor] Stream execution failed:", err);
                  controller.error(err);
                }
              }
            });

            return new Response(stream, {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
              }
            });
          } else {
            // Non-streaming request
            const response = await client.sendRequest(options);
            const data = await response.json();
            const parsed = client.parseAPIChunk(data);

            const parts: any[] = [];
            if (parsed?.thought) {
              parts.push({ text: parsed.thought, thought: true });
            }
            if (parsed?.text) {
              parts.push({ text: parsed.text });
            }
            if (parsed?.functionCall) {
              parts.push({ functionCall: parsed.functionCall });
            }

            const responseBody: any = {
              candidates: [
                {
                  content: {
                    role: "model",
                    parts
                  },
                  finishReason: "STOP",
                  index: 0
                }
              ]
            };

            if (parsed?.citations && parsed.citations.length > 0) {
              responseBody.candidates[0].groundingMetadata = {
                groundingChunks: parsed.citations.map(c => ({
                  web: { uri: c.url, title: c.title, snippet: c.snippet }
                }))
              };
            }

            return new Response(JSON.stringify(responseBody), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            });
          }
        }
      } catch (err: any) {
        console.error("[Antigravity Interceptor] Intercepted request failed:", err);
        return new Response(JSON.stringify({
          error: {
            message: `Antigravity Interceptor Error: ${err.message || err}`,
            status: "INTERNAL_ERROR"
          }
        }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    return originalFetch(input, init);
  };

  registered = true;
  console.log("[Antigravity Interceptor] Global fetch request interceptor registered.");
}

// Automatically register the fetch interceptor on import
registerFetchInterceptor();

export const AntigravityAuthPlugin = async () => {
  registerFetchInterceptor();
  return {};
};

export default AntigravityAuthPlugin;
