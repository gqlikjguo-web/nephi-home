# JunZan AI 永久安全規則

本文件是 credentials、外部服務、LINE binding 與資料安全邊界的唯一主要來源；權威與其他必讀文件見 [RULES_INDEX](RULES_INDEX.md)。

## 正式環境變更權限

未經使用者針對每次操作逐次明確批准，Agent 不得修改任何正式業者的：

- LINE Developers
- Webhook
- Render
- DNS
- 正式環境變數
- 正式資料庫
- Secret／Token

## 正式與 test-only 隔離

- 正式與 test-only 必須使用不同的瀏覽器 Profile、帳號角色、Secret、Token 與 Channel。
- Agent 可控制的瀏覽器不得登入正式 LINE Developers。
- 正式設定變更必須先由人工確認 Channel ID、舊網址及新網址，再執行變更。
- `propertyId` query parameter 不能作為 Channel 身分證明。
- 正式／test-only Channel 必須各自使用 property-scoped binding 與防誤設機制；尚未完成的真實遷移由本文件的部署 blocker 約束，不能沿用 legacy 例外。

## LINE Channel Identity Types

- `NEPHI_PILOT_LINE_CHANNEL_ID` stores the numeric Channel ID shown by LINE Developers for configuration identity and audits.
- `NEPHI_PILOT_LINE_DESTINATION_ID` stores the Bot User ID represented by webhook payload `destination`; the runtime webhook guard validates `destination` only against this field.
- Both identity types are required at startup and must never substitute for each other.
- The Bot User ID is a non-secret identifier obtained from the same Messaging API Channel's LINE Developers Basic settings page. Never copy it from another Channel or guess it.
- Channel Secret and Access Token remain sensitive and must never be written to documentation, Git, or conversation logs.

## Test-only Planner provider diagnostics

- Persisted `planner_error` records are keyed by trace ID and use a closed allowlist. They may contain bounded attempt/status values, booleans, fixed categories, model/provider identifiers, and sanitized provider error type/code/param only.
- Raw response bodies are inspected only long enough to derive allowlisted booleans and fields, then discarded. Provider messages, refusal text, prompts, guest content, source identifiers, property data, headers, stacks, tokens, API keys, credentials, and raw JSON must never be attached to errors or logs.
- Diagnostic callbacks and application logging remain isolated from the conversation fallback. A logging failure cannot prevent `planner_parse_failed` from reaching the safe handoff and existing LINE delivery path.
- Retry diagnostics add only bounded attempt count, the first and final safe error categories, and `retryPerformed`/`retrySucceeded` booleans. Retry never stores either request or response content.
- Only `timeout`, `network`, `rate_limit`, and `provider_5xx` may trigger the single retry. Invalid or unclassified content cannot expand the retry boundary.

## Property-scoped LINE binding

- 共用多業者 route 使用 `/api/line/webhooks/<webhookKey>`；`webhookKey` 只用來選出唯一候選 binding，不直接授權 property。
- 必須先用候選 binding 的 Channel Secret 驗證 raw body，驗簽成功後才可信任 binding 的 `propertyId`。
- query string 與 request body 中的 `customerId`、`propertyId` 或 destination 不得切換 property。
- Channel Secret 與 Access Token 以 AES-256-GCM 加密保存；加密金鑰只來自 `JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY`，不得保存至資料庫、Repository、log 或 API response。
- 缺少加密金鑰時，新 binding 的建立、credential 更新與 runtime 使用必須拒絕；不得以 legacy test-only env webhook、global secret/token 或 query parameter 形成例外。
- 管理 API 僅限 platform admin，且只能回傳是否已設定、webhook key 與 enabled 狀態。

## Test-only LINE binding deployment blocker

`DEPLOYMENT_BLOCKED_TEST_ONLY_LINE_BINDING_MIGRATION`

本 blocker 只有在下列條件全部有真實、可獨立核對的證據且使用者另行明確批准部署後才能解除：

- 既有 test-only LINE Channel credentials 已安全寫入目標 property binding；本輪不得讀取、記錄或改寫 credentials。
- LINE Console webhook 已從 legacy route 遷移至 `/api/line/webhooks/<webhookKey>`；本輪不得操作 LINE Console。
- 目標環境以對應 binding 驗證真實 signature、解析唯一 property，並對錯誤、未知、disabled 或 revoked binding fail closed。
- 真實 test-only LINE 帳號完成 request、reply、property identity 與時間可核對的端到端驗收。
- 部署 commit 的完整 CI 與本次核心封口獨立審查均通過。

本機測試、PGlite、isolated PostgreSQL、local HTTP、workflow、文件或 draft PR 都不能解除 blocker，也不能證明 LINE 已可直接切換。

## Onboarding intake invitations

- Initial onboarding access is issued only by an authenticated platform administrator. A public request without an invitation cannot create a staging draft.
- The database stores only the invitation token hash. Each token is bound to one onboarding application and has an explicit expiry and revocation state.
- Application IDs or frontend-supplied property IDs are never authorization. A token from one application cannot read or write another application.
- Unapproved onboarding data remains in staging and must not create formal property facts, LINE bindings, availability, or automatic replies.
- Invitation tokens, draft tokens, cookies, contact details, credentials, and raw request bodies must not be written to application logs.
- Test-only invitation, resume, and admin-setup links must use the dedicated test-only host. They must never use `app.junzanai.com`.
- Test-only startup may run migrations but must not seed data automatically.
- Deploy Hooks are credentials: use them only for the intended test-only service, rotate them after exposure, and never read back, log, or commit the replacement value.

## One-time LINE setup links

- Only an authenticated platform administrator may create, list, or revoke setup links. A link is bound to one existing formal property, expires, may be revoked, and may be consumed once.
- The database stores only a SHA-256 token hash. The raw token appears only in the one-time URL returned at creation and must not enter logs, errors, analytics, localStorage, repository files, or later API responses.
- The one-time URL carries the raw token only after `#`. The setup page removes the fragment with `history.replaceState` before resolving it by POST, sends `Referrer-Policy: no-referrer`, and rejects the former query-string resolve route.
- Redemption derives property scope only from the locked token row. A frontend `propertyId` is ignored and cannot redirect credentials to another property.
- Token validation, encrypted binding upsert, and `used_at` are one PostgreSQL transaction. Any encryption, constraint, storage, or commit failure leaves the token unused and no partial binding.
- Channel Secret and Channel Access Token use the existing AES-256-GCM envelope and `JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY`. Missing or invalid encryption configuration fails closed; the key and credential plaintext are never read back.
- Webhook-observed time is non-authoritative telemetry. A failure to record it is logged only with a hashed webhook identifier and must not reject an otherwise valid signed LINE webhook.
