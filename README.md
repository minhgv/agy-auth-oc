# Google Antigravity 2.0 Auth Provider for OpenCode

An unofficial, high-performance TypeScript/Node.js adapter to authenticate **OpenCode** against Google's internal **Antigravity 2.0 Unified Gateway** via OAuth. This provider intercepts generative AI requests and routes them through Antigravity Staging/Production endpoints, bypassing standard Google AI API billing limits and unlocking advanced thinking models.

> [!WARNING]  
> **Account Suspension Risk:** Using this plugin constitutes unofficial usage of Google's internal developer environments and violates Google's Terms of Service. A number of users have reported their Google accounts being temporarily or permanently banned/shadow-banned. Use a secondary, non-critical Google account and proceed at your own risk.

---

## Features

- **Antigravity 2.0 Unified Gateway Alignment:** Direct integration with staging/production endpoints (`daily-cloudcode-pa.googleapis.com` fallback chain) matching official `agy` CLI behavior.
- **Zero C++ Dependencies:** Avoids native compilation packages (e.g. `node-gyp` & `keytar`) using native macOS `security` child process execution, with secure file fallback (`~/.config/opencode/antigravity-accounts.json`, permission `600`).
- **Multi-Account Rotation:** Round-robin selection among multiple Google accounts. Automatically locks rate-limited accounts (429 / Overage billing limits) and shifts to the next slot without turn disruption.
- **Thinking Block Support:** Strip incoming reasoning blocks to prevent signature mismatches and cache/inject signed thoughts for assistant tool execution.
- **Grounding (Google Search) Parsing:** Converts grounding metadata from search tools to inline citations/links rendered natively in OpenCode.
- **Session Recovery:** Injects synthetic `tool_result` events if model generation is interrupted, aligning turn boundaries to prevent validation errors.

---

## Installation

Add this package to the `plugin` registry in your OpenCode configuration (typically located at `~/.config/opencode/opencode.json`):

```json
{
  "plugin": [
    "antigravity-opencode@latest"
  ]
}
```

---

## Authentication Setup

1. Run the login process through your shell to authorize the Google Client ID used by the official IDE plugin:
   ```bash
   opencode auth login
   ```
2. Select **Google** as the provider, and choose **OAuth with Google (Antigravity)**.
3. Your default browser will open to Google's authentication page. Grant permission to the required scopes (including `cloud-platform` and `experimentsandconfigs`).
4. Once completed, the local callback server on port `51121` will securely receive the authorization code and save the profile metadata to macOS Keychain or `~/.config/opencode/antigravity-accounts.json`.
5. Repeat this process with different accounts if you want to set up multi-account rotation.

---

## Model Configuration

Map the models you want to route through this provider in your `~/.config/opencode/opencode.json` configuration file:

```json
{
  "provider": {
    "google": {
      "model": {
        "gemini-3.5-flash": "google/antigravity-gemini-3.5-flash",
        "gemini-3.5-pro": "google/antigravity-gemini-3.5-pro",
        "gemini-3-pro-high": "google/antigravity-gemini-3-pro-high",
        "claude-opus-4-6-thinking": "google/antigravity-claude-opus-4-6-thinking",
        "claude-sonnet-4-6": "google/antigravity-claude-sonnet-4-6"
      }
    }
  }
}
```

### Supported Models Reference

| Model ID | Display Name | Context Window | Output Limit | Thinking Support |
| :--- | :--- | :--- | :--- | :--- |
| `gemini-3.5-flash` (Default) | Gemini 3.5 Flash | 1M tokens | 64k tokens | Yes (`minimal` level) |
| `gemini-3.5-pro` | Gemini 3.5 Pro | 1M tokens | 64k tokens | Yes (`medium` level) |
| `gemini-3-pro-high` | Gemini 3 Pro High | 1M tokens | 64k tokens | Yes (`high` level) |
| `gemini-3-pro-low` | Gemini 3 Pro Low | 1M tokens | 64k tokens | Yes (`low` level) |
| `claude-opus-4-6-thinking` | Claude Opus 4.6 | 200k tokens | 64k tokens | Yes (up to 32k budget) |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | 200k tokens | 64k tokens | No |

---

## Verification & Testing

To compile and verify the test suite:

```bash
# Install development dependencies
npm install

# Compile TypeScript
npm run build

# Run unit tests
npm run test
```

---

## Technical Details & Detection Avoidance

To mimic official IDE activity and avoid telemetry detection, the plugin enforces:
1. **Header Mimicry:**
   - `User-Agent: antigravity/1.15.8 windows/amd64`
   - `X-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1`
   - `Client-Metadata: {"ideType":"ANTIGRAVITY","platform":"MACOS","pluginType":"GEMINI"}`
2. **JSON Schema Cleansing:** Strip incompatible keywords (`$ref`, `$defs`, `default`, `examples`, and mapping `const` to single-value `enum`) that would otherwise cause structural schema errors on internal gateway endpoints.
3. **Tool Name Sanitization:** Slashes (`/`) are normalized to underscores, and names starting with digits are prefixed with an underscore.
