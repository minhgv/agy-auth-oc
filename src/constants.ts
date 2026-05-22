export const OAUTH_CONFIG = {
  // Client ID used by the official Antigravity IDE / Cloud Code plugins
  CLIENT_ID: "32555940559.apps.googleusercontent.com", 
  REDIRECT_PORT: 51121,
  REDIRECT_URI: "http://localhost:51121/callback",
  AUTH_URL: "https://accounts.google.com/o/oauth2/v2/auth",
  TOKEN_URL: "https://oauth2.googleapis.com/token",
  SCOPES: [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs"
  ]
};

export const KEYCHAIN_CONFIG = {
  SERVICE_NAME: "antigravity-cli",
  ACCOUNT_NAME: "antigravity-auth-token",
  FALLBACK_FILE_PATH: ".config/opencode/antigravity-accounts.json"
};

export const API_ENDPOINTS = {
  PRIMARY: "https://daily-cloudcode-pa.googleapis.com",
  SANDBOX_DAILY: "https://daily-cloudcode-pa.sandbox.googleapis.com",
  PRODUCTION: "https://cloudcode-pa.googleapis.com"
};

export const DEFAULT_HEADERS = {
  "User-Agent": "antigravity/1.15.8 windows/amd64",
  "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "Client-Metadata": JSON.stringify({
    ideType: "ANTIGRAVITY",
    platform: "MACOS",
    pluginType: "GEMINI"
  })
};

export interface ModelConfig {
  id: string;
  displayName: string;
  contextWindow: number;
  outputLimit: number;
  thinking: {
    supported: boolean;
    defaultLevel?: "minimal" | "low" | "medium" | "high";
    minBudget?: number;
    maxBudget?: number;
  };
}

export const DEFAULT_MODEL_ID = "gemini-3.5-flash";

export const MODELS: Record<string, ModelConfig> = {
  "claude-opus-4-6-thinking": {
    id: "claude-opus-4-6-thinking",
    displayName: "Claude Opus 4.6 Thinking",
    contextWindow: 200000,
    outputLimit: 65536,
    thinking: { supported: true, defaultLevel: "medium", minBudget: 8192, maxBudget: 32768 }
  },
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    contextWindow: 200000,
    outputLimit: 65536,
    thinking: { supported: false }
  },
  "gemini-3-pro-high": {
    id: "gemini-3-pro-high",
    displayName: "Gemini 3 Pro High",
    contextWindow: 1000000,
    outputLimit: 65536,
    thinking: { supported: true, defaultLevel: "high" }
  },
  "gemini-3-pro-low": {
    id: "gemini-3-pro-low",
    displayName: "Gemini 3 Pro Low",
    contextWindow: 1000000,
    outputLimit: 65536,
    thinking: { supported: true, defaultLevel: "low" }
  },
  "gemini-3.1-pro": {
    id: "gemini-3.1-pro",
    displayName: "Gemini 3.1 Pro",
    contextWindow: 1000000,
    outputLimit: 65536,
    thinking: { supported: true, defaultLevel: "low" }
  },
  "gemini-3.1-flash": {
    id: "gemini-3.1-flash",
    displayName: "Gemini 3.1 Flash",
    contextWindow: 1000000,
    outputLimit: 65536,
    thinking: { supported: true, defaultLevel: "minimal" }
  },
  "gemini-3.5-pro": {
    id: "gemini-3.5-pro",
    displayName: "Gemini 3.5 Pro",
    contextWindow: 1000000,
    outputLimit: 65536,
    thinking: { supported: true, defaultLevel: "medium" }
  },
  "gemini-3.5-flash": {
    id: "gemini-3.5-flash",
    displayName: "Gemini 3.5 Flash",
    contextWindow: 1000000,
    outputLimit: 65536,
    thinking: { supported: true, defaultLevel: "minimal" }
  },
  "gemini-3-flash": {
    id: "gemini-3-flash",
    displayName: "Gemini 3 Flash",
    contextWindow: 1000000,
    outputLimit: 65536,
    thinking: { supported: true, defaultLevel: "minimal" }
  },
  "gpt-oss-120b-medium": {
    id: "gpt-oss-120b-medium",
    displayName: "GPT-OSS 120B",
    contextWindow: 32768,
    outputLimit: 4096,
    thinking: { supported: false }
  }
};
