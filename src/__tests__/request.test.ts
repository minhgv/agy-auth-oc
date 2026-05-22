import { describe, it, expect } from "vitest";
import { transformRequestPayload, AntigravityClient } from "../plugin/request.js";

describe("Request Payload Transformer", () => {
  it("should transform request parameters to Antigravity gateway specifications", () => {
    const options = {
      modelId: "gemini-3.5-flash",
      projectId: "my-test-project",
      stream: true,
      temperature: 0.2,
      maxOutputTokens: 2048,
      systemInstruction: "You are an assistant.",
      contents: [
        { role: "user", parts: [{ text: "Hello" }] }
      ]
    };

    const payload = transformRequestPayload(options);
    
    expect(payload.project).toBe("my-test-project");
    expect(payload.model).toBe("gemini-3.5-flash");
    expect(payload.userAgent).toBe("antigravity");
    expect(payload.requestId).toBeDefined();
    
    const req = payload.request;
    expect(req.contents).toEqual([
      { role: "user", parts: [{ text: "Hello" }] }
    ]);
    expect(req.systemInstruction).toEqual({
      parts: [{ text: "You are an assistant." }]
    });
    expect(req.generationConfig.temperature).toBe(0.2);
    expect(req.generationConfig.maxOutputTokens).toBe(2048);
    // Gemini 3.5 Flash supports thinking, level should be minimal
    expect(req.generationConfig.thinkingConfig).toBeDefined();
    expect(req.generationConfig.thinkingLevel).toBe("minimal");
  });
});

describe("Stream Chunk Parser", () => {
  it("should parse text and citations from stream chunks", () => {
    const client = new AntigravityClient();
    
    const data = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { text: "Here is the response from search." }
            ]
          },
          groundingMetadata: {
            groundingChunks: [
              {
                web: {
                  uri: "https://example.com/info",
                  title: "Example Website",
                  snippet: "An example snippet from web search."
                }
              }
            ]
          }
        }
      ]
    };

    const parsed = client.parseAPIChunk(data);
    expect(parsed).toEqual({
      text: "Here is the response from search.",
      citations: [
        {
          title: "Example Website",
          url: "https://example.com/info",
          snippet: "An example snippet from web search."
        }
      ]
    });
  });

  it("should parse thinking block from candidate content parts", () => {
    const client = new AntigravityClient();

    const data = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                thought: true,
                text: "Calculating 2+2",
                thoughtSignature: "xyz"
              },
              {
                text: "The result is 4."
              }
            ]
          }
        }
      ]
    };

    const parsed = client.parseAPIChunk(data);
    expect(parsed).toEqual({
      thought: "Calculating 2+2",
      text: "The result is 4."
    });
  });
});
