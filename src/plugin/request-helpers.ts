/**
 * Recursively cleans JSON schemas to ensure they only contain fields supported by the Antigravity API.
 * Unsupported fields such as 'const', '$ref', '$defs', 'default', and 'examples' are cleaned or transformed.
 */
export function cleanJSONSchemaForAntigravity(schema: any): any {
  if (schema === null || typeof schema !== "object") {
    return schema;
  }

  // Handle arrays
  if (Array.isArray(schema)) {
    return schema.map(item => cleanJSONSchemaForAntigravity(item));
  }

  const cleaned: Record<string, any> = {};

  for (const [key, value] of Object.entries(schema)) {
    // 1. Skip fields that are unsupported
    if (key === "$ref" || key === "$defs" || key === "default" || key === "examples") {
      continue;
    }

    // 2. Transform 'const' to 'enum'
    if (key === "const") {
      cleaned.enum = [value];
      continue;
    }

    // 3. Recursively clean children
    cleaned[key] = cleanJSONSchemaForAntigravity(value);
  }

  return cleaned;
}

/**
 * Sanitizes tool/function names to match Gemini requirements:
 * - Max 64 characters
 * - Start with a letter (a-zA-Z) or underscore (_)
 * - Only contain alphanumeric characters, underscores, or colons (no slashes '/')
 */
export function sanitizeToolName(name: string): string {
  if (!name) return "unnamed_tool";

  // Replace slashes with colons or underscores
  let sanitized = name.replace(/\//g, "_");

  // Keep only letters, numbers, underscores, and colons
  sanitized = sanitized.replace(/[^a-zA-Z0-9_:]/g, "");

  // Ensure it starts with a letter or underscore
  if (!/^[a-zA-Z_]/.test(sanitized)) {
    sanitized = "_" + sanitized;
  }

  // Truncate to 64 characters
  if (sanitized.length > 64) {
    sanitized = sanitized.slice(0, 64);
  }

  return sanitized;
}

/**
 * Strips thinking/reasoning blocks and signatures from the contents list to prevent API signature mismatches.
 */
export function deepFilterThinkingBlocks(contents: any[]): any[] {
  if (!Array.isArray(contents)) return contents;

  return contents.map(content => {
    if (!content || !Array.isArray(content.parts)) {
      return content;
    }

    // Filter out parts that contain thinking blocks or signatures
    const filteredParts = content.parts.filter((part: any) => {
      if (!part) return false;
      
      // Filter out any parts marked as thought or containing thought signatures
      if (part.thought === true || "thoughtSignature" in part || "thought" in part) {
        return false;
      }
      
      // Filter text blocks that look like raw thought tags if any
      if (typeof part.text === "string") {
        const text = part.text.trim();
        if (text.startsWith("<thought>") && text.endsWith("</thought>")) {
          return false;
        }
      }

      return true;
    });

    return {
      ...content,
      parts: filteredParts
    };
  }).filter(content => content.parts.length > 0); // Keep turns with active parts
}
