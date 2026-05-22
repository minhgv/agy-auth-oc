/**
 * Scans the conversation history to verify that every functionCall (tool use) 
 * in model messages is paired with a corresponding functionResponse (tool result) 
 * in the subsequent user message. Injects synthetic error responses if mismatched,
 * preventing validation errors from the Google API.
 */
export function alignTurnBoundaries(contents: any[]): any[] {
  if (!Array.isArray(contents) || contents.length === 0) {
    return contents;
  }

  const aligned = JSON.parse(JSON.stringify(contents));

  for (let i = 0; i < aligned.length; i++) {
    const turn = aligned[i];
    if (!turn || !Array.isArray(turn.parts)) continue;

    // Check if the current message is from the assistant/model and contains function calls
    const isModelTurn = turn.role === "model" || turn.role === "assistant";
    if (!isModelTurn) continue;

    const functionCalls = turn.parts.filter((p: any) => p && p.functionCall);
    if (functionCalls.length === 0) continue;

    // The next turn MUST be from the user, containing function responses for each call
    const nextTurn = aligned[i + 1];

    if (!nextTurn || (nextTurn.role !== "user" && nextTurn.role !== "system")) {
      // Case 1: Subsequent turn is missing or is not from the user.
      // We inject a synthetic user message with error responses for each call.
      const syntheticParts = functionCalls.map((c: any) => ({
        functionResponse: {
          name: c.functionCall.name,
          id: c.functionCall.id || `syn_${Math.random().toString(36).substring(2, 7)}`,
          response: { error: "Session interrupted, tool execution terminated prematurely." }
        }
      }));

      aligned.splice(i + 1, 0, {
        role: "user",
        parts: syntheticParts
      });
      
      // Increment counter to skip processing the newly injected message
      i++;
    } else {
      // Case 2: Subsequent turn exists but does not contain functionResponse parts.
      const functionResponses = nextTurn.parts.filter((p: any) => p && p.functionResponse);
      
      if (functionResponses.length === 0) {
        // Inject synthetic responses before any existing parts in the user's message
        const syntheticParts = functionCalls.map((c: any) => ({
          functionResponse: {
            name: c.functionCall.name,
            id: c.functionCall.id || `syn_${Math.random().toString(36).substring(2, 7)}`,
            response: { error: "Session interrupted, tool execution terminated." }
          }
        }));

        nextTurn.parts.unshift(...syntheticParts);
      }
    }
  }

  return aligned;
}
