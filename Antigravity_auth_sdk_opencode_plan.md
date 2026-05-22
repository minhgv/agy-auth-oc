# Antigravity OAuth Provider for OpenCode — Implementation Plan (v3)

Lộ trình xây dựng OpenCode model provider sử dụng Google Antigravity OAuth (Pro/Ultra subscription) để gọi Antigravity 2.0 Unified Gateway API mà không cần API key.

**Dự án tham khảo chính**: [NoeFabris/opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) (TypeScript, MIT license, 10.6k stars, 91 releases, 691 commits). Đây là dự án **đã hoạt động production**. Plan này tận dụng trực tiếp patterns và code từ dự án này.

**Ngôn ngữ**: TypeScript (OpenCode chạy trên Node.js).

---

## 🚨 Cập nhật: Gemini CLI đã khai tử, chỉ còn Antigravity CLI & Antigravity 2.0

### Timeline Google chính thức (từ developers.googleblog.com, May 19, 2026 — Google I/O):

| Ngày              | Sự kiện                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- |
| **May 19, 2026**  | Antigravity 2.0 ra mắt. Antigravity CLI có sẵn cho tất cả mọi người (Go-based, nhanh hơn) |
| **June 18, 2026** | Gemini CLI NGỪNG phục vụ request cho Google AI Pro, Ultra, và free-tier users             |
| Ongoing           | Enterprise (Gemini Code Assist Standard/Enterprise) vẫn dùng Gemini CLI                   |

### Điều này có ý nghĩa gì với plan:

1. **Gemini CLI quota pool SẼ BIẾN MẤT** sau June 18 — không nên đầu tư vào dual quota với Gemini CLI
2. **Antigravity 2.0** là unified platform mới: desktop IDE + CLI dùng chung **cùng một agent harness server-side**
3. API endpoints có thể đã thay đổi trong Antigravity 2.0 — cần theo dõi PR #569, #574, #575 của opencode-antigravity-auth
4. **Chỉ tập trung vào Antigravity quota** — loại bỏ hoàn toàn Gemini CLI fallback khỏi plan

### opencode-antigravity-auth đang thích ứng:

- **PR #574** (open, May 21): Thêm Gemini 3.5 Flash + Pro, Gemini 3.1 Flash; rename 3.1+ models bỏ suffix `-preview`. Gemini 3.5 Flash confirmed working, 3.5 Pro chưa available.
- **PR #575** (open, May 21): **Đây là PR quan trọng nhất** — full alignment với Antigravity 2.0:
  - **Transport abstraction**: 3 transport modes (gateway mặc định, cli experimental, managed-agent experimental)
  - **New primary endpoint**: `daily-cloudcode-pa.googleapis.com` (non-sandbox daily) — thay thế sandbox daily
  - **Endpoint fallback order mới**: non-sandbox daily → sandbox daily → prod
  - **OAuth hardening**: Thêm `openid` scope, opaque PKCE state storage, redact codes/tokens
  - **Model update**: Loại bỏ Gemini CLI models khỏi defaults, chỉ giữ Antigravity quota models
  - **`CliTransport`**: Gọi `agy --print` như subprocess (experimental, mặc định disabled)
  - **`ManagedAgentTransport`**: Gọi `/v1beta/interactions` API với Gemini API key (experimental)
- **PR #569** (open, May 7): Legacy model aliasing (`gemini-3-pro` → `gemini-3.1-pro`, `claude-opus-4-5-thinking` → `claude-opus-4-6-thinking`)

---

## 🔬 Reverse Engineering: Antigravity CLI & streamGenerateContent

Kết quả phân tích hành vi thực tế từ Antigravity CLI (Go binary `agy`, v1.0.0, Mac ARM64) và log tương tác từ Antigravity IDE:

### 2.1 Thông tin về Antigravity CLI Binary
- **Đường dẫn cài đặt:** `/Users/giapminh79/.local/bin/agy` (với shell wrapper `~/.gemini/antigravity-cli/bin/agentapi`).
- **Các Subcommands được hỗ trợ:**
  - `changelog`: Hiển thị changelog và release notes.
  - `install`: Cài đặt/cấu hình môi trường.
  - `plugin` / `plugins`: Quản lý các extension/mcp servers.
  - `update`: Cập nhật phiên bản CLI.
  - `agentapi` (internal): Subcommand gọi ngầm từ IDE/SDK để khởi chạy backend daemon hỗ trợ agentic loops.

### 2.2 Quản lý Cấu hình và Trạng thái Local
CLI lưu trữ dữ liệu tại thư mục `~/.gemini/antigravity-cli/`:
- **`settings.json`**: Cấu hình theme, trusted workspaces và danh sách các quyền hạn được auto-allow (ví dụ: `command(agy)`).
- **`keybindings.json`**: Lưu phím tắt tương tác terminal.
- **`cache/onboarding.json`**: Trạng thái hoàn thành onboarding (`consumerOnboardingComplete`).
- **`cache/last_conversations.json`**: Map thư mục dự án với conversation ID hiện tại để CLI có thể tiếp tục turn (phím `-c` hoặc `--continue`).

### 2.3 Cơ chế Xác thực Keyring & Khởi chạy Server
- **Xác thực Keyring:** Thay vì ghi token OAuth ra file JSON thô, `agy` sử dụng credential helper tích hợp với macOS Keychain. Log ghi nhận: `auth.go: ChainedAuth: authenticated via keyring (effective: keyring)`.
- **Language Server nội bộ:** Khi thực hiện lệnh chat, CLI kích hoạt một tiến trình daemon (`server.go`) chạy nền trên PID ngầm, tự động lắng nghe trên một port HTTPS ngẫu nhiên phục vụ gRPC và một port HTTP ngẫu nhiên phục vụ HTTP API localhost.

### 2.4 Giao tiếp API Endpoints thực tế (Antigravity 2.0 Staging)
Khi tương tác, CLI gọi các endpoint dạng `https://daily-cloudcode-pa.googleapis.com/v1internal:*` qua giao thức HTTP REST/SSE:

| Endpoint | Giao thức | Mục đích thực tế |
| --- | --- | --- |
| `/v1internal:loadCodeAssist` | HTTP POST | Quét workspace, kiểm tra trạng thái project và thông tin user |
| `/v1internal:fetchAvailableModels` | HTTP POST | Lấy danh sách model được phép sử dụng cho tài khoản |
| `/v1internal:streamGenerateContent?alt=sse` | HTTP POST + SSE | Truyền tải prompt và nhận dữ liệu stream token-by-token (Đang dùng) |
| `/v1internal:listExperiments` | HTTP POST | Tải các configs/ab-testing của Google dành cho User |

### 2.5 Kết luận về Transport & Endpoint
1. **Endpoint Target:** Toàn bộ request từ CLI đang hướng trực tiếp tới staging server `daily-cloudcode-pa.googleapis.com` chứ không phải production.
2. **Quyết định cho plugin:** Sử dụng `streamGenerateContent` trên primary endpoint `daily-cloudcode-pa.googleapis.com` làm đích đến mặc định. Đây là cách mimic an toàn và chuẩn xác nhất theo traffic thực tế từ CLI.

---

## ⚠️ Cảnh báo về Rủi ro Phát hiện & Khóa Account

> **Đây là vấn đề nghiêm trọng nhất.** Plugin `opencode-antigravity-auth` đã **cảnh báo rõ ràng** trong README:
>
> > "A number of users have reported their Google accounts being **banned** or **shadow-banned** (restricted access without explicit notification)."
>
> Google có khả năng phát hiện việc sử dụng API không chính thức. Để giảm thiểu rủi ro, plan này tập trung vào việc **mimic chính xác** format request/response của Antigravity IDE.

### Các biện pháp tránh bị phát hiện (theo opencode-antigravity-auth)

1. **Headers giả lập Antigravity IDE**:
   ```
   User-Agent: antigravity/1.15.8 windows/amd64
   X-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1
   Client-Metadata: {"ideType":"ANTIGRAVITY","platform":"MACOS","pluginType":"GEMINI"}
   ```
2. **Format Gemini-style (KHÔNG dùng Anthropic format)**:
   - `role: "model"` (không `"assistant"`)
   - `contents[].parts[]` (không `messages[].content[]`)
   - `systemInstruction` là object với `parts[]` (không string trần)
3. **Request wrapper đúng format**:
   ```json
   { "project": "project_id", "model": "model_id", "request": {...}, "userAgent": "antigravity", "requestId": "unique" }
   ```
4. **JSON Schema cleansing**: Loại bỏ `const`, `$ref`, `$defs`, `$schema`, `default`, `examples` — các field không được Antigravity API hỗ trợ
5. **Thinking block stripping**: Xóa toàn bộ thinking blocks khỏi request gửi đi (OpenCode có thể làm hỏng `thoughtSignature`)
6. **Function name rules**: Chỉ chấp nhận tên tool bắt đầu bằng chữ cái hoặc `_`, không có `/`, max 64 ký tự

### Rủi ro còn tồn tại

| Rủi ro                                   | Mức độ                 | Ghi chú                                |
| ---------------------------------------- | ---------------------- | -------------------------------------- |
| Google thay đổi API endpoints            | Cao                    | Cần monitoring + update liên tục       |
| Google thêm rate limiting fingerprinting | Trung bình             | Multi-account rotation giúp giảm thiểu |
| Account bị ban hoàn toàn                 | Thấp nhưng hậu quả lớn | Đây là trade-off không thể tránh khỏi  |
| OAuth scope thay đổi                     | Thấp                   | Scope ít khi thay đổi                  |

---

## 0. Các sai lầm đã sửa từ plan cũ

| Sai (plan cũ)                                                      | Đúng (plan v2)                                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Triển khai bằng Python trong repo `antigravity-sdk-python`         | OpenCode là TypeScript → dự án Node.js/TypeScript riêng                                                   |
| Tạo `OAuthConnection Strategy` kế thừa `Connection` của SDK Python | Gọi thẳng HTTP API Antigravity (không qua Go binary/SDK Python)                                           |
| Tạo module `antigravity.opencode` trong SDK Python                 | SDK Python không liên quan — đây là dự án hoàn toàn độc lập                                               |
| Gọi `cloudaicompanion.googleapis.com`                              | Gọi `cloudcode-pa.googleapis.com` hoặc `daily-cloudcode-pa.sandbox.googleapis.com`                        |
| Liệt kê model `gemini-3.1-pro`                                     | Model thực tế: `claude-opus-4-6-thinking`, `claude-sonnet-4-6`, `gemini-3-pro-high/low`, `gemini-3.1-pro` |
| Không đề cập đến risk bị ban account                               | Bổ sung section cảnh báo + biện pháp bảo vệ                                                               |

---

## 1. Kiến trúc Tổng quan

> **Tham khảo kiến trúc từ PR #575**: Plugin đã extract transport layer thành interface riêng. Plan này follow cùng pattern.

### 1.1 Ba Trụ Cột của Antigravity 2.0 SDK
Kiến trúc SDK được xây dựng trên mô hình 3 lớp chính nhằm tách biệt tầng ứng dụng và tầng truyền tải:
1. **Agent**: Điểm truy cập cấu hình (`LocalAgentConfig`), quản lý vòng đời session, quản lý các hooks, tự động đăng ký và quản lý các built-in/custom tools.
2. **Conversation**: Quản lý lịch sử hội thoại (stateful session), xử lý nén ngữ cảnh (compaction), chia luồng lượt tương tác (turns) và cung cấp giao diện tương tác streaming (`chat()`).
3. **Connection**: Tầng truyền tải (Transport layer) độc lập. Nhiệm vụ duy nhất là gửi payload đi và xử lý kết quả trả về, cho phép dễ dàng switch giữa trực tiếp Gateway HTTP, qua CLI local subprocess, hoặc Managed Agent API.

### 1.2 Kiến trúc Tương tác của Antigravity CLI (`agy`)
Antigravity CLI hoạt động theo mô hình client-server local:
- Khi một session CLI bắt đầu (qua lệnh `/Users/giapminh79/.local/bin/agy`), nó khởi chạy một tiến trình con (Go-based language server `server.go`).
- Lớp server này lắng nghe trên một port HTTPS ngẫu nhiên (sử dụng gRPC làm giao thức truyền thông nội bộ với IDE/CLI client) và một port HTTP ngẫu nhiên.
- Dữ liệu xác thực (tokens thu được sau OAuth PKCE flow) được CLI quản lý và lưu trữ trực tiếp bằng dịch vụ macOS Keychain (`keyring`) để đảm bảo an toàn, thay vì lưu text file thô.
- Các cấu hình local, lịch sử hội thoại và thông tin onboarding được quản lý tại thư mục cache `~/.gemini/antigravity-cli/`.

```
┌────────────────────────────────────────────────┐
│  OpenCode (TypeScript)                         │
│  ┌──────────────────────────────────────────┐  │
│  │ AntigravityProvider (fetch interceptor)   │  │
│  └───────────┬──────────────────────────────┘  │
└──────────────┼─────────────────────────────────┘
               │ Transport interface
┌──────────────┼─────────────────────────────────┐
│  antigravity-opencode (npm package)            │
│  ┌───────────┴──────────────────────────────┐  │
│  │ GatewayTransport (DEFAULT)               │  │
│  │  ├─ request.ts (format transformer)      │  │
│  │  ├─ request-helpers.ts (schema clean)    │  │
│  │  ├─ thinking-recovery.ts                 │  │
│  │  ├─ recovery.ts (session fix)            │  │
│  │  └─ Streaming SSE → OpenCode             │  │
│  ├──────────────────────────────────────────┤  │
│  │ auth.ts (token lifecycle & Keyring hook) │  │
│  ├──────────────────────────────────────────┤  │
│  │ oauth.ts (PKCE flow + openid scope)      │  │
│  ├──────────────────────────────────────────┤  │
│  │ accounts.ts (multi-account rotation)     │  │
│  └──────────────────────────────────────────┘  │
└──────────────┬─────────────────────────────────┘
               │ Bearer Token + IDE-matching Headers
┌──────────────┴─────────────────────────────────┐
│  cloudcode-pa.googleapis.com                   │
│  ├─ /v1internal:streamGenerateContent?alt=sse  │  ← SSE streaming (BATTLE-TESTED)
│  ├─ /v1internal:generateContent                │  ← Non-streaming
│  ├─ /v1internal:loadCodeAssist                 │  ← Project discovery
│  └─ /v1internal:onboardUser                    │  ← User onboarding
│                                                  │
│  (NOT USED — format unknown, cần RE thêm)       │
│  ├─ /v1internal:streamGenerateChat             │  ← Antigravity 2.0 chat API
│  ├─ /v1internal:fetchAvailableModels           │  ← Model discovery
│  ├─ /v1internal:listModelConfigs               │  ← Model config listing
│  └─ /v1internal:retrieveUserQuota              │  ← Quota checking
└────────────────────────────────────────────────┘
```

### 1.3 Endpoint fallback order (theo PR #575)

Plugin thử endpoint theo thứ tự:

1. `https://daily-cloudcode-pa.googleapis.com` (non-sandbox daily — **primary**, match `agy` CLI)
2. `https://daily-cloudcode-pa.sandbox.googleapis.com` (sandbox daily — legacy fallback)
3. `https://cloudcode-pa.googleapis.com` (production)

Autopush sandbox (`autopush-cloudcode-pa.sandbox.googleapis.com`) đã bị loại bỏ khỏi fallback chain.

---

## 2. Các Thành phần Core

### 2.1 OAuth Flow (`oauth.ts`)

**Tham khảo**: `opencode-antigravity-auth/src/antigravity/oauth.ts`

- **PKCE (Proof Key for Code Exchange)**:
  - Sử dụng `@openauthjs/openauth/pkce`
  - Client ID: Dùng client_id của Antigravity IDE
  - Redirect URI: `http://localhost:{port}/callback`
  - Scope: `cloud-platform`, `userinfo.email`, `userinfo.profile`, `cclog`, `experimentsandconfigs`, `openid` (mới — PR #575)
- **Authorization**: `https://accounts.google.com/o/oauth2/v2/auth` (local-callback) hoặc `https://accounts.google.com/o/oauth2/auth` (official-callback, experimental)
- **Token Exchange**: `https://oauth2.googleapis.com/token`
- **PKCE State Storage**: Opaque state nonce trong in-memory TTL map (PR #575) — không embed verifier trong URL
- **Storage**: `~/.config/opencode/antigravity-accounts.json` (permission 600)

### 2.2 Auth Manager (`auth.ts`)

**Tham khảo**: `opencode-antigravity-auth/src/plugin/auth.ts`

- Token validation + auto-refresh.
- Expiry check trước mỗi request.
- 401 handler: refresh → retry.
- **Tích hợp Keychain (Keyring Auth):**
  - CLI `agy` lưu trữ và xác thực refresh token qua macOS Keychain thay vì lưu text file thô (qua `auth.go` credential helper).
  - OpenCode Provider sẽ mô phỏng hành vi này bằng cách tích hợp thư viện `keytar` (dành cho môi trường Node.js độc lập) hoặc sử dụng API `SecretStorage` có sẵn của OpenCode/VS Code extension.
  - Token refresh/access sẽ được kiểm tra trạng thái keychain trước khi gọi API. Nếu keychain không phản hồi hoặc bị từ chối, provider sẽ fallback về tệp cấu hình an toàn `~/.config/opencode/antigravity-accounts.json` (chỉ cấp quyền 600).

### 2.3 API Client / Request Transformer (`request.ts`) ⭐ CRITICAL

**Tham khảo**: `opencode-antigravity-auth/src/plugin/request.ts` (~2000+ lines)

Đây là component **quan trọng nhất** quyết định việc có bị phát hiện hay không.

#### 2.3.1 Endpoints (đã xác minh từ API spec + PR #575)

Khi CLI và SDK hoạt động, luồng request sẽ đi qua các endpoint staging primary để kiểm tra phiên làm việc và thực hiện sinh nội dung. Cụ thể:

| Environment       | URL                                                    | Status                                  |
| ----------------- | ------------------------------------------------------ | --------------------------------------- |
| Daily Non-Sandbox | `https://daily-cloudcode-pa.googleapis.com`            | ✅ **Primary** (match `agy` CLI v1.0.0) |
| Daily Sandbox     | `https://daily-cloudcode-pa.sandbox.googleapis.com`    | ⚠️ Legacy fallback                      |
| Production        | `https://cloudcode-pa.googleapis.com`                  | ✅ Active (dùng cho Gemini CLI header)  |
| Autopush Sandbox  | `https://autopush-cloudcode-pa.sandbox.googleapis.com` | ❌ Removed khỏi fallback chain          |

Các hành động gọi thực tế bao gồm:
- **`/v1internal:loadCodeAssist`** (HTTP POST): Được gọi ngay khi khởi tạo session để đồng bộ trạng thái project, metadata người dùng và kiểm tra quota/premium status.
- **`/v1internal:fetchAvailableModels`** (HTTP POST): Trả về danh sách các model hợp lệ dành riêng cho tài khoản dựa trên subscription level.
- **`/v1internal:streamGenerateContent?alt=sse`** (HTTP POST + SSE): Streaming sinh nội dung token-by-token (Sử dụng chính).
- **`/v1internal:listExperiments`** (HTTP POST): Lấy danh sách thử nghiệm A/B testing từ Google để cấu hình runtime.

#### 2.3.2 Headers bắt buộc (để tránh bị phát hiện)

Để tránh bị hệ thống giám sát của Google phát hiện hành vi gọi không chính thức và ban tài khoản, request gửi đi bắt buộc phải giả lập chính xác 100% headers của Antigravity CLI và IDE:

```http
Authorization: Bearer {access_token}
Content-Type: application/json
User-Agent: antigravity/1.15.8 windows/amd64
X-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1
Client-Metadata: {"ideType":"ANTIGRAVITY","platform":"MACOS","pluginType":"GEMINI"}
```

Đối với các request streaming (SSE) bắt buộc bổ sung:

```http
Accept: text/event-stream
```

#### 2.3.3 Request Format (MUST match Antigravity IDE exactly)

```json
{
  "project": "{project_id}",
  "model": "{model_id}",
  "request": {
    "contents": [
      { "role": "user", "parts": [{ "text": "Hello" }] },
      { "role": "model", "parts": [{ "text": "Hi!" }] }
    ],
    "systemInstruction": {
      "parts": [{ "text": "You are helpful." }]
    },
    "generationConfig": {
      "maxOutputTokens": 1000,
      "temperature": 0.7,
      "thinkingConfig": {
        "thinkingBudget": 8000,
        "includeThoughts": true
      }
    },
    "tools": [
      {
        "functionDeclarations": [
          {
            "name": "get_weather",
            "description": "Get weather",
            "parameters": {
              "type": "object",
              "properties": {
                "location": { "type": "string" }
              },
              "required": ["location"]
            }
          }
        ]
      }
    ]
  },
  "userAgent": "antigravity",
  "requestId": "{unique_id}"
}
```

#### 2.3.4 Format Conversion Rules (CRITICAL — sai là bị detect)

| OpenCode Input                   | Antigravity API Output                                 |
| -------------------------------- | ------------------------------------------------------ |
| `role: "assistant"`              | `role: "model"`                                        |
| `messages[].content` (string)    | `contents[].parts[{text: "..."}]`                      |
| `messages[].content` (array)     | `contents[].parts[{text: "..."}, {functionCall: ...}]` |
| `system` message                 | `systemInstruction.parts[{text: "..."}]`               |
| `tool_use` block                 | `parts[{functionCall: {name, args, id}}]`              |
| `tool_result` block              | `parts[{functionResponse: {name, id, response}}]`      |
| `thinking` block (Claude)        | **STRIP hoàn toàn** (không gửi lại)                    |
| `thoughtSignature`               | **STRIP hoàn toàn**                                    |
| JSON Schema `const`              | `enum: [value]`                                        |
| JSON Schema `$ref`/`$defs`       | Inline definitions                                     |
| JSON Schema `default`/`examples` | Remove                                                 |
| Tool name với `/`                | Replace bằng `_` hoặc `:`                              |
| Tool name bắt đầu bằng số        | Prefix với `_`                                         |

#### 2.3.5 Response Transformation (Antigravity API → OpenCode)

- **Streaming SSE**: Parse `data:` events → extract `response.candidates[].content.parts[]` → emit chunks.
- **Thinking format**: `{thought: true, text: "...", thoughtSignature: "..."}` → OpenCode reasoning block.
- **Function call**: `{functionCall: {name, args, id}}` → OpenCode tool_use.
- **Finish reason**: `STOP`, `MAX_TOKENS`, `OTHER`.
- **Usage**: `usageMetadata.{promptTokenCount, candidatesTokenCount, totalTokenCount, thoughtsTokenCount}`.
- **Google Search Grounding (Tìm kiếm thông tin thực tế):**
  - Trích xuất dữ liệu từ `response.candidates[].groundingMetadata`.
  - Phân tích nguồn dẫn tìm kiếm (`groundingChunks` và `webSearchQueries`).
  - Chuyển đổi và map sang dạng citations/links trực quan trong giao diện OpenCode để hiển thị nguồn thông tin tìm kiếm thực tế cho người dùng, đảm bảo hành vi hiển thị tương thích hoàn toàn như trên Antigravity IDE.

### 2.4 Thinking Block Management (CRITICAL)

**Tham khảo**: `opencode-antigravity-auth/src/plugin/request-helpers.ts`

**Strategy**: Strip ALL thinking blocks from outgoing requests. OpenCode stores thinking between turns nhưng có thể corrupt `thoughtSignature`. Gửi thinking blocks với signature sai → API sẽ báo lỗi → dễ bị phát hiện.

```
Turn 1: Claude response có {thought: true, text: "...", thoughtSignature: "abc"}
         → OpenCode lưu cả thinking blocks
Turn 2: Plugin STRIPS tất cả thinking blocks trước khi gửi
         → Claude generates fresh thinking (không lỗi signature)
```

**Tool use pairing**: Claude yêu cầu thinking block trước `tool_use`. Plugin:

1. Cache signed thinking từ response
2. Inject cached thinking trước tool_use trong request tiếp theo
3. Chỉ inject vào **first assistant message** của mỗi turn

### 2.5 Session Recovery (`recovery.ts`)

**Tham khảo**: `opencode-antigravity-auth/src/plugin/recovery.ts`

Xử lý các lỗi session thường gặp:

- `tool_use without tool_result`: Inject synthetic `tool_result` blocks
- `Expected thinking but found text`: Close corrupted turn, start fresh

### 2.6 Account Manager (`accounts.ts`)

**Tham khảo**: `opencode-antigravity-auth/src/plugin/accounts.ts`

- Multi-account rotation (sticky → round-robin khi rate limited).
- **Chỉ Antigravity quota** — Gemini CLI quota pool sắp biến mất (June 18, 2026).
- Per-model-family rate limit tracking.
- Auto failover khi gặp 429.
- **Support AI Credit Overages (Hỗ trợ vượt hạn mức tín dụng trả phí):**
  - Tích hợp phát hiện các header cảnh báo hoặc lỗi đặc thù liên quan tới overage billing (Issue #536).
  - Khi một account kích hoạt tính năng Overage (cho phép chạy quá hạn mức tiêu chuẩn có trả phí bổ sung), hệ thống xoay vòng cần nhận diện được mã lỗi hết mức overage để thực hiện failover sang account khác, hoặc thông báo cảnh báo chi phí lên OpenCode console.

---

## 3. Cập nhật Danh sách Model (từ API spec + README của opencode-antigravity-auth)

### Antigravity 2.0 quota (DUY NHẤT — Gemini CLI đã khai tử)

> **⚠️ Gemini CLI quota pool sẽ biến mất sau June 18, 2026. Chỉ tập trung vào Antigravity quota.**

| Model ID                   | Tên hiển thị             | Context | Output | Thinking                           | Ghi chú                                       |
| -------------------------- | ------------------------ | ------- | ------ | ---------------------------------- | --------------------------------------------- |
| `claude-opus-4-6-thinking` | Claude Opus 4.6 Thinking | 200k    | 64k    | low: 8192, max: 32768              |                                               |
| `claude-sonnet-4-6`        | Claude Sonnet 4.6        | 200k    | 64k    | Không                              |                                               |
| `gemini-3-pro-high`        | Gemini 3 Pro High        | 1M      | 64k    | Có (mặc định)                      |                                               |
| `gemini-3-pro-low`         | Gemini 3 Pro Low         | 1M      | 64k    | Có (mặc định)                      |                                               |
| `gemini-3.1-pro`           | Gemini 3.1 Pro           | 1M      | 64k    | low, high                          | Rollout-dependent; bỏ suffix `-preview`       |
| `gemini-3.1-flash`         | Gemini 3.1 Flash         | 1M      | 64k    | Có                                 | **Mới** — PR #574 đang thêm                   |
| `gemini-3.5-pro`           | Gemini 3.5 Pro           | -       | -      | Có                                 | **Mới** — PR #574 đang thêm; có thể chưa live |
| `gemini-3.5-flash`         | Gemini 3.5 Flash         | -       | -      | Có (backend yêu cầu thinkingLevel) | **Mới** — PR #574 confirmed working           |
| `gemini-3-flash`           | Gemini 3 Flash           | 1M      | 64k    | minimal, low, medium, high         |                                               |
| `gpt-oss-120b-medium`      | GPT-OSS 120B             | -       | -      | Không                              |                                               |

### Naming convention (Antigravity 2.0 — updated từ PR #574)

- **3.1+ models**: Dùng tên gốc, không có suffix (vd: `gemini-3.1-pro`, không phải `gemini-3.1-pro-preview`)
- **3.0 line**: Giữ suffix `-preview` cho backward compatibility
- **Gemini 3.5 Flash**: Backend yêu cầu `thinkingLevel` phải được set (nếu không có → lỗi). `minimal` là mặc định hợp lý.
- **Model `antigravity-gemini-3.5-pro`**: Chưa confirmed working (trả về "Requested entity was not found"). Cần theo dõi.
- **Model prefix**: Antigravity API nhận cả `antigravity-` prefix và bare names; plugin tự map.

### 3.2 Model Mặc định & Hành vi Runtime
- **Model mặc định:** `gemini-3.5-flash` được chỉ định là model mặc định trong OpenCode provider do tính cân bằng giữa tốc độ và khả năng suy luận logic.
- **Yêu cầu đặc thù:** Backend Antigravity yêu cầu cấu hình `thinkingLevel` rõ ràng đối với dòng Gemini 3.5 (ví dụ: `minimal`, `low`, `medium`, `high`). Nếu thiếu, API sẽ trả về mã lỗi 400 Bad Request.

### 3.3 Bản đồ Cấu hình Model từ `LocalAgentConfig`
Cấu hình agent nội bộ được ánh xạ từ `LocalAgentConfig` sang payload của REST/SSE client của Provider:
- **`tools`**: Mảng chứa thông tin định nghĩa các tools mà agent được phép gọi (bao gồm custom tools của người dùng hoặc các built-in tools của hệ thống).
- **`mcp_servers`**: Khai báo danh sách các Model Context Protocol (MCP) servers đang active, hỗ trợ mở rộng khả năng của agent qua các service ngoài.
- **`system_instructions`**: Chuỗi chỉ thị hệ thống (System Prompt) hướng dẫn hành vi của model, tự động đóng gói thành cấu trúc `systemInstruction.parts[{text: "..."}]` trước khi gửi đi.
- **`app_data_dir`**: Đường dẫn thư mục lưu trữ cục bộ để duy trì state, logs, và dữ liệu hội thoại (mặc định trỏ về `~/.gemini/antigravity/brain/`).

### 3.4 Danh mục Tools Tích hợp (`BuiltinTools`)
Antigravity 2.0 SDK cung cấp tập hợp các công cụ hệ thống được định nghĩa qua enum `BuiltinTools`. Khi OpenCode yêu cầu thực thi các tác vụ này, request client sẽ dịch chúng sang cấu trúc tool call tương ứng:
1. `list_directory`: Liệt kê tệp tin và thư mục con trong một đường dẫn chỉ định.
2. `search_directory`: Tìm kiếm mẫu văn bản/pattern bằng ripgrep trong thư mục.
3. `find_file`: Tìm kiếm đường dẫn tệp tin theo tên hoặc pattern.
4. `view_file`: Xem nội dung tệp tin văn bản (hỗ trợ đọc phân đoạn lớn lên tới 800 dòng) hoặc tệp tin nhị phân.
5. `finish`: Đánh dấu hoàn thành toàn bộ nhiệm vụ được giao.
6. `create_file`: Tạo mới tệp tin và ghi nội dung.
7. `edit_file`: Sửa đổi nội dung tệp tin hiện tại (thực hiện drop-in replacement).
8. `run_command`: Chạy lệnh terminal trực tiếp (mặc định luôn yêu cầu xác nhận thủ công từ người dùng để bảo mật).
9. `ask_question`: Đưa ra câu hỏi lựa chọn hoặc làm rõ yêu cầu từ phía người dùng.
10. `start_subagent`: Khởi chạy một tiến trình subagent độc lập (nhận chỉ thị và báo cáo kết quả lại cho parent agent).
11. `generate_image`: Tạo hoặc chỉnh sửa hình ảnh từ mô tả văn bản làm mockup/asset cho ứng dụng.

---

## 4. Cấu trúc Dự án

```
antigravity-opencode/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                    # Entry point, export plugin
│   ├── plugin.ts                   # Main fetch interceptor
│   ├── constants.ts                # Endpoints, headers, model IDs
│   ├── antigravity/
│   │   ├── oauth.ts                # PKCE OAuth flow
│   │   └── server.ts              # Local OAuth callback server
│   ├── plugin/
│   │   ├── auth.ts                 # Token management + refresh
│   │   ├── request.ts              # Request/response transformation (CORE)
│   │   ├── request-helpers.ts      # Schema cleaning, thinking filters
│   │   ├── thinking-recovery.ts    # Turn boundary, crash recovery
│   │   ├── recovery.ts             # Session recovery
│   │   ├── accounts.ts             # Multi-account management
│   │   ├── quota.ts                # Quota checking
│   │   ├── cache.ts                # Auth & signature caching
│   │   ├── config/
│   │   │   ├── schema.ts           # Zod config schema
│   │   │   └── loader.ts          # Config file loading
│   │   └── debug.ts                # Debug logging
│   └── __tests__/
│       ├── oauth.test.ts
│       ├── auth.test.ts
│       ├── request.test.ts
│       └── integration.test.ts
```

---

## 5. Lộ trình Triển khai (Milestones)

### Milestone 1: Foundation + OAuth (Tuần 1)

- [ ] Khởi tạo dự án TypeScript với package.json, tsconfig.json
- [ ] Cài đặt dependencies: `@openauthjs/openauth/pkce`, `open` (mở browser)
- [ ] Implement `src/antigravity/oauth.ts` — PKCE flow với:
  - [ ] Opaque PKCE state storage (in-memory TTL map — theo PR #575)
  - [ ] `openid` scope trong OAuth scope set
  - [ ] Local callback server (mặc định)
  - [ ] Redact codes, tokens, verifiers khỏi logs
- [ ] Implement `src/antigravity/server.ts` — Local callback server
- [ ] Implement `src/plugin/auth.ts` — Token management cơ bản
- [ ] Test: `npx tsx src/cli/login.ts` → browser mở → Google login → redirect → token lưu

### Milestone 2: API Client (Tuần 2) ⭐ CRITICAL

- [ ] Implement `src/plugin/request.ts` — Request transformer (theo format của `ANTIGRAVITY_API_SPEC.md`):
  - [ ] Message format mapping (user/model/system)
  - [ ] Contents array construction đúng Gemini format
  - [ ] Thinking block stripping (`deepFilterThinkingBlocks`)
  - [ ] JSON Schema cleansing (`cleanJSONSchemaForAntigravity`)
  - [ ] Tool definition mapping (functionDeclarations)
  - [ ] Function name validation (start with letter, no `/`)
  - [ ] Headers injection (User-Agent, X-Goog-Api-Client, Client-Metadata)
  - [ ] Request wrapper: `{project, model, request, userAgent, requestId}`
- [ ] Implement endpoint fallback logic:
  - [ ] Primary: `daily-cloudcode-pa.googleapis.com`
  - [ ] Fallback: `daily-cloudcode-pa.sandbox.googleapis.com` → `cloudcode-pa.googleapis.com`
- [ ] Implement SSE streaming response transformer
- [ ] Test: Gọi API `streamGenerateContent?alt=sse` với token OAuth → nhận response stream
- [ ] Implement thinking block caching + injection cho tool use

### Milestone 3: OpenCode Provider Integration (Tuần 3)

- [ ] Implement `GatewayTransport` — wrapper quanh request.ts (theo pattern PR #575)
- [ ] Implement `src/plugin.ts` — OpenCode fetch interceptor
- [ ] Implement `src/index.ts` — Plugin exports
- [ ] Đăng ký plugin vào OpenCode ecosystem
- [ ] Test end-to-end: Chat trong OpenCode qua Antigravity
- [ ] Hỗ trợ tool calling (MCP tools)
- [ ] Google Search grounding support
- [ ] Viết README với hướng dẫn cài đặt

### Milestone 4: Polish & Recovery (Tuần 4)

- [ ] Multi-account rotation (`accounts.ts`) — **chỉ Antigravity quota**
- [ ] Quota management (`quota.ts`)
- [ ] Session recovery (`recovery.ts`): `tool_use without tool_result`, thinking errors
- [ ] Thinking recovery (`thinking-recovery.ts`): turn boundary detection
- [ ] Error handling toàn diện (429 retry with delay, 401 refresh, 400 format fix)

(Showing lines 450-490 of 575. Use offset=491 to continue.)

- [ ] Debug logging (`debug.ts`)
- [ ] Đóng gói npm package
- [ ] CI/CD (GitHub Actions: lint, typecheck, test)

---

## 6. Tiêu chí Kiểm thử (Verification)

| #   | Test                   | Expected                                                                                       |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | Auth                   | Browser OAuth → token lưu `~/.config/opencode/antigravity-accounts.json`                       |
| 2   | API Call               | Gọi `cloudcode-pa.googleapis.com/v1internal:streamGenerateContent` thành công với Bearer token |
| 3   | Streaming              | Response hiển thị real-time token-by-token                                                     |
| 4   | Tools                  | Agent gọi được tools (file ops, shell, etc.)                                                   |
| 5   | Thinking               | Claude Opus 4.6 + Gemini 3 hiển thị thinking blocks                                            |
| 6   | Token Refresh          | Access token hết hạn → tự động refresh → request thành công                                    |
| 7   | Session Recovery       | Sau lỗi `tool_use` mismatch, agent tiếp tục bình thường                                        |
| 8   | **Format Correctness** | Request gửi đi match chính xác format Antigravity IDE (kiểm tra headers + body)                |
| 9   | Schema Clean           | JSON Schema không chứa `const`, `$ref`, `$defs`...                                             |
| 10  | Thinking Strip         | Thinking blocks được strip khỏi request gửi đi                                                 |

---

## 7. Bảo mật & Rủi ro

| Vấn đề                   | Biện pháp                                                           |
| ------------------------ | ------------------------------------------------------------------- |
| Token storage            | `~/.config/opencode/antigravity-accounts.json` permission 600       |
| Token in transit         | HTTPS only                                                          |
| API protocol changes     | Monitoring + fallback endpoint chain: daily → autopush → prod       |
| Account ban              | Multi-account rotation, soft quota threshold (90%)                  |
| Detection fingerprinting | Headers matching Antigravity IDE, exact format matching             |
| Session corruption       | Auto-recovery: inject synthetic tool_results, close corrupted turns |

---

## 8. Dependencies Chính

```json
{
  "dependencies": {
    "@openauthjs/openauth": "^x.x.x", // PKCE OAuth flow
    "open": "^x.x.x" // Mở browser cho auth
  },
  "devDependencies": {
    "typescript": "^5.x",
    "vitest": "^x.x",
    "zod": "^3.x" // Config schema validation
  }
}
```

Node.js `fetch` (native từ v18+) là đủ cho HTTP client. Không cần axios/undici.

---

## 9. So sánh với opencode-antigravity-auth

| Khía cạnh           | opencode-antigravity-auth                     | Plan này                                                   |
| ------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| Scope               | Multi-provider (Antigravity + Gemini CLI)     | **Antigravity 2.0-only** (Gemini CLI đã khai tử)           |
| Code reuse          | N/A                                           | Fork core patterns: OAuth, request transform, recovery     |
| Models              | Đầy đủ cả 2 quota pools                       | **Chỉ Antigravity quota** (không Gemini CLI fallback)      |
| Gemini CLI fallback | Có (sẽ bị loại bỏ trong tương lai)            | **Không** (đầu tư vào thứ sắp chết là vô ích)              |
| Complexity          | Cao (multi-provider, multi-account, CLI auth) | **Trung bình** (chỉ Antigravity, simpler codebase)         |
| Antigravity 2.0     | Đang thích ứng (PR #569, #574, #575 open)     | **Target Antigravity 2.0 ngay từ đầu**                     |
| Transport           | 3 modes (gateway, cli, managed-agent)         | **Chỉ Gateway** (đơn giản nhất, battle-tested)             |
| Endpoint chính      | `daily-cloudcode-pa.googleapis.com`           | **Giống plugin** — follow endpoint mới từ PR #575          |
| API                 | `streamGenerateContent` (legacy, stable)      | **streamGenerateContent** — không mạo hiểm với API chưa RE |
| OAuth               | 6 scopes (thêm `openid`), opaque PKCE state   | **Giống plugin** — follow OAuth hardening từ PR #575       |

---

## 10. Kết luận về Tính khả thi

1. **Về kỹ thuật**: Hoàn toàn khả thi. `opencode-antigravity-auth` đã chứng minh với 10.6k stars và 91 releases.
2. **Về rủi ro**: Luôn tồn tại rủi ro bị Google phát hiện/khóa account. Cần cảnh báo rõ cho người dùng.
3. **Về effort**: ~4 tuần cho 1 developer, nhanh hơn nếu fork trực tiếp từ opencode-antigravity-auth.
4. **Key differentiator**: Format chính xác 100% với Antigravity IDE là yếu tố sống còn.
5. **Gemini CLI dead → cơ hội**: Không cần lo dual quota complexity. Focus 100% vào Antigravity 2.0 API.
6. **Timing tốt**: Antigravity 2.0 vừa ra mắt (May 19, 2026). Community plugin đang active chuyển đổi. Nếu bắt đầu ngay, có thể ship trước hoặc cùng lúc với các bản update của opencode-antigravity-auth.
7. **`streamGenerateChat` chưa sẵn sàng**: Format API mới này chưa được ai reverse engineer. Không nên dùng cho đến khi có document đầy đủ. Stick với `streamGenerateContent` đã battle-tested.

## 11. Theo dõi các PR quan trọng của opencode-antigravity-auth

| PR   | Status | Mô tả                                                          | Ảnh hưởng đến plan                    |
| ---- | ------ | -------------------------------------------------------------- | ------------------------------------- |
| #574 | Open   | Thêm Gemini 3.5 Flash/Pro, 3.1 Flash; bare names cho 3.1+      | **Critical** — model list + naming    |
| #575 | Open   | Align Antigravity auth, transports, models với Antigravity 2.0 | **Critical** — có thể có endpoint mới |
| #569 | Open   | Fix stale model routing                                        | Medium — model routing logic          |
| #536 | Open   | AI Credit Overages support                                     | Low — nice-to-have                    |
