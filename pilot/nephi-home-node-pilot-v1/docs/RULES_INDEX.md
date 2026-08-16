# JunZan AI 規則權威索引

本文件只指定權威、責任、狀態與衝突路由，不複製各文件全文。開始工作時先讀兩層 `AGENTS.md` 與本索引，再讀本次範圍對應的 active authority。

## 優先順序

1. 使用者在當前任務的明確指示。
2. Repository 根目錄 `AGENTS.md` 的全域誠信與證據底線。
3. `pilot/nephi-home-node-pilot-v1/AGENTS.md` 的專案入口與更嚴格規則。
4. 本 `docs/RULES_INDEX.md` 的權威與責任映射。
5. 下表對應 scope 的 active authority。

專案層不得弱化根層誠信底線。同一層文件若矛盾、同一 scope 出現兩個 active authority，或索引與檔案現況不一致，必須停止並回報；不得猜測優先順序或採用較寬鬆版本。未列為 active 的歷史文件不能作為當前規則。

## Authority registry

| Authority | Scope | Status | Supersedes/Conflict action |
|---|---|---|---|
| `docs/CODEX_EXECUTION_INTEGRITY_CONTRACT.md` | Codex execution integrity | active | Codex 防作假、完整交付、旁路封閉、證據鏈、BLOCKED 與測試分類的唯一契約；衝突時停止 |
| `docs/JUNZAN_AI_CONSTITUTION.md` | Product architecture principles | active | 產品行為與架構原則；本次不可修改；衝突時停止 |
| `docs/SECURITY.md` | Security and external services | active | Credentials、外部服務、LINE binding 與資料安全邊界；衝突時停止 |
| `docs/PRODUCT_BASELINE.md` | Accepted product behavior | active | 已接受且有證據的產品行為；未驗證聲明不得寫入 |
| `docs/DECISIONS.md` | Architecture decisions | active | 以唯一編號、狀態與 crosswalk 保存決策；不得改寫歷史原文 |
| `docs/LESSONS_LEARNED.md` | Production incidents and proven failures | active | production 事故、rollback、退化與已證明失敗方案；只讀本次相關章節 |
| `docs/CONTROLLED_ARCHITECTURE_RULES.md` | Controlled core architecture | active | 受控核心架構與責任邊界；衝突時停止 |
| `docs/PROJECT_MEMORY.md` | Current project facts | active | 當前已證明事實、限制與 blocker；不保存歷史完成流水帳；不得作為即時 Git／部署狀態證據 |
| `docs/NEXT_TASKS.md` | Unfinished work queue | active | 尚未完成且可執行的工作順序；不保存完成歷史；不是正式版本、production 狀態或修改授權來源 |
| `docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md` | Core architecture acceptance | active | 既有核心驗收標準；本次 byte-identical，不得自行修改 |

## Historical routing

歷史設計、計畫、交接與 changelog 只提供背景；除非上表明列為 active authority，不得覆蓋現行規則或作為完成證據。未來若驗收標準本身被證明錯誤，只能在使用者事前明確批准、不得同時修改 runtime、具有獨立審查與新舊基準對照的獨立任務處理；本次沒有 bootstrap、update 或 bypass 權限。
