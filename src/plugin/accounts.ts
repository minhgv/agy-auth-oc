import { AuthManager, SavedCredentials } from "./auth.js";
import { TokenResponse } from "../antigravity/oauth.js";

export interface AccountProfile {
  email: string;
  credentials: SavedCredentials;
  rateLimitedUntil: number; // timestamp in ms
}

export class AccountManager {
  private static instance: AccountManager;
  private authManager: AuthManager;
  private profiles: AccountProfile[] = [];
  private activeEmail: string | null = null;

  private constructor() {
    this.authManager = AuthManager.getInstance();
    this.loadProfiles();
  }

  public static getInstance(): AccountManager {
    if (!AccountManager.instance) {
      AccountManager.instance = new AccountManager();
    }
    return AccountManager.instance;
  }

  // Load account profiles from the secure auth manager storage
  private loadProfiles(): void {
    const creds = this.authManager.loadCredentials();
    if (!creds) {
      this.profiles = [];
      this.activeEmail = null;
      return;
    }

    // Check if the credentials block stores a multi-account structure
    try {
      if ((creds as any).profiles && Array.isArray((creds as any).profiles)) {
        this.profiles = (creds as any).profiles;
        this.activeEmail = (creds as any).activeEmail || null;
      } else {
        // Fallback/Backward compatibility: migrate single account to multi-account list
        const fallbackEmail = "default-user@google-antigravity";
        this.profiles = [{
          email: fallbackEmail,
          credentials: {
            accessToken: creds.accessToken,
            refreshToken: creds.refreshToken,
            expiryTime: creds.expiryTime
          },
          rateLimitedUntil: 0
        }];
        this.activeEmail = fallbackEmail;
      }
    } catch (e) {
      this.profiles = [];
      this.activeEmail = null;
    }
  }

  // Save profiles back to the secure store
  private saveProfiles(): void {
    if (this.profiles.length === 0) {
      this.authManager.clearCredentials();
      return;
    }

    // Select activeEmail if not set
    if (!this.activeEmail && this.profiles.length > 0) {
      this.activeEmail = this.profiles[0].email;
    }

    const activeProfile = this.profiles.find(p => p.email === this.activeEmail);
    const primaryCreds: SavedCredentials = activeProfile 
      ? activeProfile.credentials 
      : this.profiles[0].credentials;

    // We store the main token inside standard fields, and attach the profiles metadata list
    const credentialsPayload = {
      ...primaryCreds,
      profiles: this.profiles,
      activeEmail: this.activeEmail
    };

    this.authManager.saveCredentials(credentialsPayload as any);
  }

  public getProfiles(): AccountProfile[] {
    return this.profiles;
  }

  public getActiveEmail(): string | null {
    return this.activeEmail;
  }

  // Add or update an account profile
  public addAccount(email: string, response: TokenResponse): void {
    const creds: SavedCredentials = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiryTime: Date.now() + response.expires_in * 1000
    };

    const existingIndex = this.profiles.findIndex(p => p.email === email);
    if (existingIndex !== -1) {
      // Keep existing refresh_token if new one is not returned in response
      const oldRefreshToken = this.profiles[existingIndex].credentials.refreshToken;
      if (!creds.refreshToken && oldRefreshToken) {
        creds.refreshToken = oldRefreshToken;
      }
      this.profiles[existingIndex].credentials = creds;
      this.profiles[existingIndex].rateLimitedUntil = 0; // reset locks
    } else {
      this.profiles.push({
        email,
        credentials: creds,
        rateLimitedUntil: 0
      });
    }

    this.activeEmail = email;
    this.saveProfiles();
  }

  // Retrieve valid access token for the active account
  public async getActiveAccessToken(): Promise<string> {
    this.loadProfiles();
    
    if (!this.activeEmail || this.profiles.length === 0) {
      throw new Error("No accounts available. Please log in.");
    }

    const profile = this.profiles.find(p => p.email === this.activeEmail);
    if (!profile) {
      throw new Error(`Active account ${this.activeEmail} not found in profiles.`);
    }

    // To use AuthManager helper, temporarily copy active credentials to primary index, then retrieve
    const mockCreds: SavedCredentials = {
      accessToken: profile.credentials.accessToken,
      refreshToken: profile.credentials.refreshToken,
      expiryTime: profile.credentials.expiryTime
    };

    // Use a temp manager instance to validate/refresh
    this.authManager.saveCredentials(mockCreds);
    const validToken = await this.authManager.getValidAccessToken();

    // Sync refreshed token back to profiles
    const updatedCreds = this.authManager.loadCredentials();
    if (updatedCreds) {
      profile.credentials.accessToken = updatedCreds.accessToken;
      profile.credentials.expiryTime = updatedCreds.expiryTime;
      if (updatedCreds.refreshToken) {
        profile.credentials.refreshToken = updatedCreds.refreshToken;
      }
    }

    this.saveProfiles();
    return validToken;
  }

  // Rotate to the next available account that is not rate limited
  public rotateAccount(): boolean {
    this.loadProfiles();
    if (this.profiles.length <= 1) return false;

    const currentIndex = this.profiles.findIndex(p => p.email === this.activeEmail);
    const now = Date.now();

    for (let i = 1; i <= this.profiles.length; i++) {
      const nextIndex = (currentIndex + i) % this.profiles.length;
      const candidate = this.profiles[nextIndex];

      // Check if candidate account is locked/rate limited
      if (candidate.rateLimitedUntil < now) {
        this.activeEmail = candidate.email;
        console.log(`Rotated active account to: ${this.activeEmail}`);
        this.saveProfiles();
        return true;
      }
    }

    console.warn("All configured accounts are currently rate limited.");
    return false;
  }

  // Temporarily block account due to 429 rate limit or overage limits (default 5 minutes)
  public markRateLimited(email: string, durationMs: number = 5 * 60 * 1000): void {
    const profile = this.profiles.find(p => p.email === email);
    if (profile) {
      profile.rateLimitedUntil = Date.now() + durationMs;
      console.warn(`Account ${email} marked as rate-limited until ${new Date(profile.rateLimitedUntil).toLocaleTimeString()}`);
      this.saveProfiles();
    }
  }

  // Remove account profile
  public removeAccount(email: string): void {
    this.profiles = this.profiles.filter(p => p.email !== email);
    if (this.activeEmail === email) {
      this.activeEmail = this.profiles.length > 0 ? this.profiles[0].email : null;
    }
    this.saveProfiles();
  }
}
