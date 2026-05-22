import { execSync } from "child_process";
import os from "os";
import fs from "fs";
import path from "path";
import { KEYCHAIN_CONFIG } from "../constants.js";
import { refreshToken, TokenResponse } from "../antigravity/oauth.js";

const isMac = os.platform() === "darwin";

export interface SavedCredentials {
  accessToken: string;
  refreshToken?: string;
  expiryTime: number; // timestamp in milliseconds
}

// Write JSON payload directly into Keychain
export function writeToKeyring(data: string): boolean {
  if (!isMac) return false;
  try {
    // Escaping double quotes for shell arguments
    const escapedData = data.replace(/"/g, '\\"');
    execSync(
      `security add-generic-password -a "${KEYCHAIN_CONFIG.ACCOUNT_NAME}" -s "${KEYCHAIN_CONFIG.SERVICE_NAME}" -w "${escapedData}" -U`
    );
    return true;
  } catch (err) {
    console.warn("Failed to write to macOS Keychain:", err);
    return false;
  }
}

// Read JSON payload from Keychain
export function readFromKeyring(): string | null {
  if (!isMac) return null;
  try {
    const output = execSync(
      `security find-generic-password -a "${KEYCHAIN_CONFIG.ACCOUNT_NAME}" -s "${KEYCHAIN_CONFIG.SERVICE_NAME}" -w`
    );
    return output.toString().trim();
  } catch (err) {
    // Return null if credentials do not exist
    return null;
  }
}

// Delete credential from Keychain
export function deleteFromKeyring(): boolean {
  if (!isMac) return false;
  try {
    execSync(
      `security delete-generic-password -a "${KEYCHAIN_CONFIG.ACCOUNT_NAME}" -s "${KEYCHAIN_CONFIG.SERVICE_NAME}"`
    );
    return true;
  } catch (err) {
    return false;
  }
}

export class AuthManager {
  private static instance: AuthManager;
  private cachedCreds: SavedCredentials | null = null;

  private constructor() {}

  public static getInstance(): AuthManager {
    if (!AuthManager.instance) {
      AuthManager.instance = new AuthManager();
    }
    return AuthManager.instance;
  }

  private getFallbackPath(): string {
    return path.join(os.homedir(), KEYCHAIN_CONFIG.FALLBACK_FILE_PATH);
  }

  // Load credentials from Keychain or file
  public loadCredentials(): SavedCredentials | null {
    if (this.cachedCreds) {
      return this.cachedCreds;
    }

    // Try Keychain first
    const keyringData = readFromKeyring();
    if (keyringData) {
      try {
        this.cachedCreds = JSON.parse(keyringData) as SavedCredentials;
        return this.cachedCreds;
      } catch (err) {
        console.error("Failed to parse credentials from Keyring:", err);
      }
    }

    // Try file fallback
    const fallbackPath = this.getFallbackPath();
    if (fs.existsSync(fallbackPath)) {
      try {
        const fileContent = fs.readFileSync(fallbackPath, "utf-8");
        this.cachedCreds = JSON.parse(fileContent) as SavedCredentials;
        return this.cachedCreds;
      } catch (err) {
        console.error("Failed to read fallback credentials file:", err);
      }
    }

    return null;
  }

  // Save credentials to Keychain and/or file fallback
  public saveCredentials(creds: SavedCredentials): void {
    this.cachedCreds = creds;
    const jsonString = JSON.stringify(creds);

    // Save to Keychain if on Mac
    let savedToKeyring = false;
    if (isMac) {
      savedToKeyring = writeToKeyring(jsonString);
    }

    // Save to fallback file anyway for backup or if Keyring fails/not supported
    const fallbackPath = this.getFallbackPath();
    const dirPath = path.dirname(fallbackPath);
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      fs.writeFileSync(fallbackPath, jsonString, { mode: 0o600 });
    } catch (err) {
      console.error("Failed to save credentials to file system:", err);
      if (!savedToKeyring) {
        throw new Error("Could not persist credentials to either Keychain or File System.");
      }
    }
  }

  // Convert TokenResponse and persist
  public saveTokenResponse(response: TokenResponse): void {
    const creds: SavedCredentials = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token || this.cachedCreds?.refreshToken,
      // Expiry timestamp in ms
      expiryTime: Date.now() + response.expires_in * 1000
    };
    this.saveCredentials(creds);
  }

  public clearCredentials(): void {
    this.cachedCreds = null;
    if (isMac) {
      deleteFromKeyring();
    }
    const fallbackPath = this.getFallbackPath();
    if (fs.existsSync(fallbackPath)) {
      try {
        fs.unlinkSync(fallbackPath);
      } catch (err) {
        console.error("Failed to delete fallback token file:", err);
      }
    }
  }

  // Get valid Access Token, auto-refreshing if expired or near expiry
  public async getValidAccessToken(): Promise<string> {
    const creds = this.loadCredentials();
    if (!creds) {
      throw new Error("No authentication credentials found. Please log in.");
    }

    const fiveMinutes = 5 * 60 * 1000;
    const isExpired = Date.now() + fiveMinutes >= creds.expiryTime;

    if (!isExpired) {
      return creds.accessToken;
    }

    // Attempt token refresh
    if (!creds.refreshToken) {
      throw new Error("Access token expired and no refresh token is available. Please re-authenticate.");
    }

    try {
      console.log("Access token near expiry. Refreshing...");
      const refreshResponse = await refreshToken(creds.refreshToken);
      this.saveTokenResponse(refreshResponse);
      return refreshResponse.access_token;
    } catch (err) {
      console.error("Failed to refresh access token automatically:", err);
      throw new Error("Session expired and auto-refresh failed. Please log in again.");
    }
  }
}
