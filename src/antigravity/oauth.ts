import crypto from "crypto";
import { OAUTH_CONFIG } from "../constants.js";

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
  token_type: string;
  scope: string;
}

export function generateCodeVerifier(): string {
  // Generate high-entropy code verifier
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  // Generate SHA-256 hash of verifier
  return crypto
    .createHash("sha256")
    .update(verifier)
    .digest()
    .toString("base64url");
}

export function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function generateAuthUrl(codeChallenge: string, state: string): string {
  const url = new URL(OAUTH_CONFIG.AUTH_URL);
  url.searchParams.append("client_id", OAUTH_CONFIG.CLIENT_ID);
  url.searchParams.append("redirect_uri", OAUTH_CONFIG.REDIRECT_URI);
  url.searchParams.append("response_type", "code");
  url.searchParams.append("scope", OAUTH_CONFIG.SCOPES.join(" "));
  url.searchParams.append("code_challenge", codeChallenge);
  url.searchParams.append("code_challenge_method", "S256");
  url.searchParams.append("state", state);
  // Ensure access type is offline to receive refresh_token
  url.searchParams.append("access_type", "offline");
  url.searchParams.append("prompt", "consent");
  return url.toString();
}

export async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: OAUTH_CONFIG.CLIENT_ID,
    client_secret: OAUTH_CONFIG.CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    redirect_uri: OAUTH_CONFIG.REDIRECT_URI
  });

  const response = await fetch(OAUTH_CONFIG.TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to exchange code for tokens: ${response.status} - ${errorText}`);
  }

  return (await response.json()) as TokenResponse;
}

export async function refreshToken(refreshTokenStr: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: OAUTH_CONFIG.CLIENT_ID,
    client_secret: OAUTH_CONFIG.CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshTokenStr
  });

  const response = await fetch(OAUTH_CONFIG.TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to refresh token: ${response.status} - ${errorText}`);
  }

  return (await response.json()) as TokenResponse;
}
