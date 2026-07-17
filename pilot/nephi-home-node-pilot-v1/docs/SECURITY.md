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
