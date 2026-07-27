# JunZan AI 永久安全規則

本文件是安全規則的唯一主要來源；專案入口與其他必讀文件見 [專案記憶入口](PROJECT_MEMORY.md)。

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
- 後續必須實作正式／test-only Channel 綁定與防誤設機制。

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
- 缺少加密金鑰時，新 binding 的建立、credential 更新與 runtime 使用必須拒絕；既有 legacy test-only env webhook 不受影響。
- 管理 API 僅限 platform admin，且只能回傳是否已設定、webhook key 與 enabled 狀態。
