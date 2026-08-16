# JunZan AI 工作地圖
本檔只負責導航，不保存完整規則、歷史紀錄或即時版本狀態。
Repository、Git、測試、正式資料與 production 證據才是事實來源。

## JunZan AI 最高原則

JunZan AI 是多旅宿共用自動客服，不是 FAQ、關鍵字或固定句型機器人。
OpenAI 負責理解自然語言、上下文、多問題、口語、錯字與省略。
JunZan 受控核心負責正式資料、狀態、Resolver、決策與安全。
AI 不是正式事實來源；Unknown 不等於 No。
不得猜測、捏造、漏答或為單一說法／單一業者增加特殊補丁。

## 開始任何工作

先讀：
1. Repository 根目錄 AGENTS.md
2. 再讀 [docs/RULES_INDEX.md](docs/RULES_INDEX.md)。
3. 再依本次任務只讀必要的正式文件

不得弱化 Repository 根目錄 AGENTS.md 的完整性、證據、測試分類與完成聲明規則。
不得使用聊天記憶、舊 Session 或猜測取代 Repository 證據。

完整產品憲法：
→ docs/JUNZAN_AI_CONSTITUTION.md

## 不同任務去哪裡

已接受、不得退化的產品行為：
→ docs/PRODUCT_BASELINE.md

重大架構與產品決策：
→ docs/DECISIONS.md

過去事故、rollback、regression 與失敗教訓：
→ docs/LESSONS_LEARNED.md
只搜尋本次 failure layer、function、contract、capability 相關章節。

受控核心責任與架構：
→ docs/CONTROLLED_ARCHITECTURE_RULES.md

核心驗收標準：
→ docs/CONTROLLED_ARCHITECTURE_TEST_ACCEPTANCE.md

Codex 執行、證據與修改安全：
→ docs/CODEX_EXECUTION_INTEGRITY_CONTRACT.md

LINE、資料庫、Render、Credential 與外部服務安全：
→ docs/SECURITY.md

目前專案背景與待辦：
→ docs/PROJECT_MEMORY.md
→ docs/NEXT_TASKS.md
這兩份不得作為即時 HEAD、worktree、branch、remote SHA、
live SHA、dirty state 或正式環境狀態證據。

## 核心修改固定流程

真實 production FAIL
→ production 證據
→ earliest failure
→ exact function / transition
→ 現有 Contract
→ direct production consumers
→ 相關歷史教訓
→ 第一個共同根因
→ 最小通用修法
→ 使用者批准
→ RED
→ 最小修改
→ GREEN
→ affected regression
→ 必要時完整測試一次

任何既有 PASS 因本次修改變 FAIL：立即停止。

## 權限

ChatGPT：調查、技術判斷、方案與結果審查。
Codex：只依已批准範圍實作與測試。
使用者：決定產品行為，批准核心修改、真實 OpenAI 與正式部署。

沒有足夠證據時：
「目前證據不足，不能安全下指令。」
