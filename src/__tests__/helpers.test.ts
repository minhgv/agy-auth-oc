import { describe, it, expect } from "vitest";
import { cleanJSONSchemaForAntigravity, sanitizeToolName, deepFilterThinkingBlocks } from "../plugin/request-helpers.js";
import { alignTurnBoundaries } from "../plugin/recovery.js";

describe("JSON Schema Cleaner", () => {
  it("should remove unsupported keywords and rewrite const to enum", () => {
    const inputSchema = {
      type: "object",
      properties: {
        env: {
          type: "string",
          const: "production"
        },
        version: {
          type: "string",
          default: "1.0.0",
          examples: ["1.0.0"]
        },
        meta: {
          $ref: "#/definitions/Meta"
        }
      },
      required: ["env"]
    };

    const expectedSchema = {
      type: "object",
      properties: {
        env: {
          type: "string",
          enum: ["production"]
        },
        version: {
          type: "string"
        },
        meta: {}
      },
      required: ["env"]
    };

    const output = cleanJSONSchemaForAntigravity(inputSchema);
    expect(output).toEqual(expectedSchema);
  });
});

describe("Tool Name Sanitizer", () => {
  it("should replace forward slashes and ensure proper prefixes", () => {
    expect(sanitizeToolName("my/tool/path")).toBe("my_tool_path");
    expect(sanitizeToolName("123tool")).toBe("_123tool");
    expect(sanitizeToolName("valid_tool:name")).toBe("valid_tool:name");
    expect(sanitizeToolName("invalid$char#tool")).toBe("invalidchartool");
    expect(sanitizeToolName("a".repeat(100))).toBe("a".repeat(64));
  });
});

describe("Thinking Block Filter", () => {
  it("should filter out thinking blocks from model responses", () => {
    const contents = [
      {
        role: "model",
        parts: [
          { thought: true, text: "thinking metadata", thoughtSignature: "sig" },
          { text: "hello user!" }
        ]
      }
    ];

    const filtered = deepFilterThinkingBlocks(contents);
    expect(filtered).toEqual([
      {
        role: "model",
        parts: [
          { text: "hello user!" }
        ]
      }
    ]);
  });
});

describe("Turn Boundary Alignment", () => {
  it("should inject synthetic responses for unmatched tool calls", () => {
    const contents = [
      {
        role: "model",
        parts: [
          {
            functionCall: {
              name: "read_file",
              args: { path: "test.txt" },
              id: "call_1"
            }
          }
        ]
      },
      {
        role: "user",
        parts: [
          { text: "Just continue" }
        ]
      }
    ];

    const aligned = alignTurnBoundaries(contents);
    
    // The aligned output should have a functionResponse prepended to the user turn's parts
    expect(aligned[1].parts[0].functionResponse).toBeDefined();
    expect(aligned[1].parts[0].functionResponse.name).toBe("read_file");
    expect(aligned[1].parts[0].functionResponse.id).toBe("call_1");
    expect(aligned[1].parts[1].text).toBe("Just continue");
  });

  it("should inject full synthetic user turn if next turn is not user", () => {
    const contents = [
      {
        role: "model",
        parts: [
          {
            functionCall: {
              name: "view_file",
              args: { path: "main.js" },
              id: "call_2"
            }
          }
        ]
      }
    ];

    const aligned = alignTurnBoundaries(contents);
    expect(aligned.length).toBe(2);
    expect(aligned[1].role).toBe("user");
    expect(aligned[1].parts[0].functionResponse).toBeDefined();
    expect(aligned[1].parts[0].functionResponse.name).toBe("view_file");
  });
});
