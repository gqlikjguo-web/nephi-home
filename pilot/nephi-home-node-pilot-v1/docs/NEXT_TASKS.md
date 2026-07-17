# JunZan AI 下一步任務

Repository 是專案真實來源，不得依賴 ChatGPT 記憶或 Codex session。

任務必須依序執行：

1. 根據正式 LINE Webhook 安全稽核結果，完成正式／test-only 權限與環境硬隔離。
2. 確認 `junzan-ai` 實際部署 commit 為 `6822516`。
3. 在乾淨環境完整執行 `npm test`，必須取得明確 exit 0。
4. 完成 test-only LINE 真實驗收：
   - `8/6 有雙人房嗎？有車位嗎？可以烤肉嗎？`
   - `8/6 有雙人房嗎？`
5. 驗收通過後，建立 `docs/JUNZAN_AI_CONSTITUTION.md`。
6. Constitution 完成後，才建立 ADR 與 Architecture 文件。

Constitution 是已排定的必要任務，不得跳過。
