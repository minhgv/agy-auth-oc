import { execSync } from "child_process";
import os from "os";
import { AuthManager } from "../plugin/auth.js";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateAuthUrl,
  exchangeCodeForTokens
} from "../antigravity/oauth.js";
import { startCallbackServer } from "../antigravity/server.js";

async function runLogin() {
  console.log("---------------------------------------------------------");
  console.log("🔑 Google Antigravity 2.0 Auth Login for OpenCode");
  console.log("---------------------------------------------------------");

  try {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();
    const authUrl = generateAuthUrl(codeChallenge, state);

    console.log("1. Starting local callback server on port 51121...");
    const serverPromise = startCallbackServer(state);

    console.log("\n2. Opening Google Sign-in flow in your default browser...");
    console.log("URL:", authUrl);

    // Open browser automatically depending on OS
    const platform = os.platform();
    try {
      if (platform === "darwin") {
        execSync(`open "${authUrl}"`);
      } else if (platform === "win32") {
        execSync(`start "" "${authUrl}"`);
      } else {
        execSync(`xdg-open "${authUrl}"`);
      }
    } catch (e) {
      console.log("\n⚠️  Could not open browser automatically. Please copy & paste the URL above manually.");
    }

    console.log("\n3. Waiting for Google consent verification callback...");
    const authCode = await serverPromise;

    console.log("\n4. Exchanging authorization code for API tokens...");
    const tokens = await exchangeCodeForTokens(authCode, codeVerifier);

    console.log("\n5. Storing credentials securely...");
    AuthManager.getInstance().saveTokenResponse(tokens);

    console.log("\n🎉 Authentication successful! Google Antigravity account is now registered.");
    console.log("Credentials saved in Keychain or ~/.config/opencode/antigravity-accounts.json");
    console.log("---------------------------------------------------------");
  } catch (error) {
    console.error("\n❌ Authentication failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

runLogin();
