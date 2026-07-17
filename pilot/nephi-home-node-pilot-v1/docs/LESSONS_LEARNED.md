# JunZan AI 經驗教訓

## 正式 LINE Webhook 事件

- 尼腓的家正式 LINE Channel 曾被指向 test-only endpoint。
- 因 Channel Secret 不對應，造成 `INVALID_LINE_SIGNATURE`／HTTP 401，正式帳號無法自動回覆。
- 使用者將 Webhook 改回正式網址後，正式帳號立即恢復。
- 現有證據無法證明是 Codex 或使用者修改。
- 已確認 repository、部署流程與專案腳本沒有自動修改 LINE Webhook 的能力。
- 真正的流程問題是正式與 test-only 缺少權限、帳號及環境的硬隔離。
- 未來不得只靠人工辨識 LINE Channel 頁面，必須建立技術與權限防線。
