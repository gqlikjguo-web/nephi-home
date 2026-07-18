# JunZan AI Agent 工作規則

## Repository 是唯一可信來源

任何 Agent 或 Codex 任務開始前，必須先閱讀：

1. `docs/PROJECT_MEMORY.md`
2. `docs/PRODUCT_BASELINE.md`
3. `docs/JUNZAN_AI_CONSTITUTION.md`
4. `docs/DECISIONS.md`
5. `docs/SECURITY.md`
6. `docs/NEXT_TASKS.md`

不得依賴 ChatGPT 對話、ChatGPT Memory、Codex Session 或未寫入 Repository 的舊交接內容判定專案事實。

## 維護責任

- 重大決策完成時，append `docs/DECISIONS.md`，不得覆蓋既有決策。
- 正式驗收通過且形成不可退步行為時，更新 `docs/PRODUCT_BASELINE.md`。
- 重要 bug、事故或可重複避免的錯誤，更新 `docs/LESSONS_LEARNED.md`。
- 核心能力或安全邊界的重要 commit，以一句摘要更新 `docs/CHANGELOG_INTERNAL.md`。
- 優先順序、blocker 或驗收狀態改變時，更新 `docs/PROJECT_MEMORY.md` 與 `docs/NEXT_TASKS.md`。
- 同一知識只保留一份主要敘述，其他文件以相對連結引用。

## 執行邊界

所有工作必須遵守 Constitution、Product Baseline 與 Security。若任務指令與 Repository 現況衝突，先以實際程式碼、測試、部署證據與上述文件釐清，不得猜測或自行擴大範圍。
