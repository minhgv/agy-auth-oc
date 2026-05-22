import http from "http";
import { OAUTH_CONFIG } from "../constants.js";

export function startCallbackServer(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || "", `http://localhost:${OAUTH_CONFIG.REDIRECT_PORT}`);
        if (reqUrl.pathname === "/oauth-callback") {
          const code = reqUrl.searchParams.get("code");
          const state = reqUrl.searchParams.get("state");

          if (state !== expectedState) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end("<h3>Error: State mismatch! Secure login verification failed.</h3>");
            server.close();
            reject(new Error("State mismatch in OAuth callback"));
            return;
          }

          if (!code) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end("<h3>Error: Authorization code not found in request.</h3>");
            server.close();
            reject(new Error("Authorization code missing"));
            return;
          }

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Antigravity Auth Successful</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background-color: #0f172a; color: #f8fafc; margin: 0; }
                .card { text-align: center; padding: 2.5rem; background: #1e293b; border-radius: 1rem; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3); border: 1px solid #334155; }
                h1 { color: #38bdf8; margin-top: 0; }
                p { color: #94a3b8; font-size: 1.1rem; }
              </style>
            </head>
            <body>
              <div class="card">
                <h1>✓ Authenticated Successfully</h1>
                <p>Google Antigravity 2.0 Auth configured. You can now close this tab.</p>
              </div>
            </body>
            </html>
          `);
          
          server.close();
          resolve(code);
        } else {
          res.writeHead(404);
          res.end("Not Found");
        }
      } catch (err) {
        res.writeHead(500);
        res.end("Internal Server Error");
        server.close();
        reject(err);
      }
    });

    server.listen(OAUTH_CONFIG.REDIRECT_PORT, () => {
      console.log(`OAuth callback server listening on http://localhost:${OAUTH_CONFIG.REDIRECT_PORT}`);
    });

    server.on("error", (err) => {
      reject(err);
    });
  });
}
