# JunZan AI 永久安全規則

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
