# JunZan AI 第一版正式上線 Checklist

本清單是第一版正式上線前的統一追蹤入口。已驗收且不得退步的產品行為以 [PRODUCT_BASELINE.md](PRODUCT_BASELINE.md) 為準；目前執行順序以 [NEXT_TASKS.md](NEXT_TASKS.md) 為準。本清單不得取代正式測試、真實驗收或逐次正式環境操作授權。

## 1. AI 核心

以下項目延續既有第一版驗收基準，不得因上線收尾而降低：

- [ ] Resolver 仍是房況、價格、設備及政策的唯一可信事實來源。
- [ ] Unknown 不得回答成 No。
- [ ] 一句多問的所有子問題均有明確結果，不得漏答。
- [ ] 多輪補充、修改與清除不受舊 Conversation State 污染。
- [ ] 回覆只使用可信 facts，驗證失敗時仍有安全且非空的回覆。
- [ ] 所有查詢、state、message log、review 與 routing 維持 property scope 隔離。
- [ ] 相同輸入、相同狀態與相同事實來源得到一致結果。

驗收依據：[PRODUCT_BASELINE.md](PRODUCT_BASELINE.md)、[JUNZAN_AI_CONSTITUTION.md](JUNZAN_AI_CONSTITUTION.md)。

## 2. 前台（Frontend）

### 公開 API 不得暴露 propertyId

- [ ] 公開 API 已移除內部 `propertyId`。
- [ ] 已完成防退化測試，證明公開 response 不會重新出現內部 `propertyId`。

目前：公開 Availability API 仍可能回傳 `propertyId`。

正式版規則：任何公開 API 均不得暴露內部 `propertyId`。

狀態：**待修**

### 是否支援多晚查詢

目前：旅客只能查一晚；選擇入住日期後，退房日期固定為隔天。

待使用者決策：第一版是否支援多晚查詢。

狀態：**待決策**

## 3. 後台（Admin）

目前未發現第一版必修問題。

後續若驗收發現第一版 blocker，再新增至本節；不得把第二版功能提前列為第一版上線必要條件。

## 4. 業者填寫（Onboarding）

### 最後預覽頁需完整

- [ ] 送審前可完整預覽基本資料。
- [ ] 送審前可完整預覽地址與 LINE。
- [ ] 送審前可完整預覽房型與四類價格。
- [ ] 送審前可完整預覽包棟資料。
- [ ] 送審前可完整預覽 FAQ 與設施。
- [ ] 送審前可完整預覽入住時間與退房時間。
- [ ] 送審前可完整預覽第一版所有送審內容。

狀態：**待修**

### FAQ 狀態文字

目前共用文字：

- 有
- 沒有
- 需轉真人
- 尚未確定

建議文字：

- 已有正式資料
- 不提供／不適用
- 需要人工說明
- 尚未確認

狀態：**待修**

### LINE 官方帳號驗證

待確認第一版是否要求：

- [ ] 加好友網址必填。
- [ ] Channel ID 保留。

狀態：**待決策**

## 5. LINE 驗收

- [ ] 真實 test-only LINE 可收到單一、非空回覆，且同一 event 不會重複處理或重複回覆。
- [ ] 指定日期、指定房型與最近可住房況完成真實驗收。
- [ ] 後台切換可售／不可售後，下一次 LINE 查詢立即取得最新房況。
- [ ] 多問題訊息完整回答，只有需要人工的子問題局部轉交。
- [ ] 多輪補充、修改與清除條件完成真實驗收。
- [ ] Google Maps、停車、烤肉、戲水池與 FAQ 完成真實驗收。
- [ ] 正式 LINE 切換前已建立可用回退點。
- [ ] 正式 LINE、Webhook 或 credential 的每一次變更均已取得使用者逐次明確授權。

目前狀態與驗收順序以 [PROJECT_MEMORY.md](PROJECT_MEMORY.md) 及 [NEXT_TASKS.md](NEXT_TASKS.md) 為準。

## 6. 部署驗收

- [ ] 部署 commit 與核准上線的 commit SHA 完全一致。
- [ ] Render service 顯示 Live。
- [ ] `/api/health` 回 HTTP 200。
- [ ] health `status=ready`。
- [ ] test-only 部署的 health `testOnly=true`。
- [ ] Planner、PostgreSQL provider 及必要 runtime dependency 均 ready。
- [ ] 完整自動測試 exit 0，且完整訊息處理鏈可產生非空 reply payload。
- [ ] 正式與 test-only 的 LINE、Webhook、Render、環境變數、資料庫及 credentials 維持隔離。
- [ ] 已記錄上一個已知可用 commit、回退條件及回退後驗證步驟。

## 7. 第一版正式驗收（Acceptance）

每項完成後須勾選，並填寫日期、Commit SHA（若有）及驗收人。沒有程式變更的人工驗收可將 Commit SHA 填為「不適用」。

| 完成 | 驗收項目 | 日期 | Commit SHA | 驗收人 |
| --- | --- | --- | --- | --- |
| [ ] | 日期理解 |  |  |  |
| [ ] | 房況查詢 |  |  |  |
| [ ] | 包棟查詢 |  |  |  |
| [ ] | 指定房型 |  |  |  |
| [ ] | 指定房號 |  |  |  |
| [ ] | 多問題同句 |  |  |  |
| [ ] | 多輪追問 |  |  |  |
| [ ] | Google Maps |  |  |  |
| [ ] | 停車 |  |  |  |
| [ ] | 烤肉 |  |  |  |
| [ ] | 戲水池 |  |  |  |
| [ ] | FAQ |  |  |  |
| [ ] | 前台驗收 |  |  |  |
| [ ] | 後台驗收 |  |  |  |
| [ ] | Onboarding 驗收 |  |  |  |
| [ ] | LINE 真實驗收 |  |  |  |
| [ ] | Render 正式部署 |  |  |  |
| [ ] | 真實使用者驗收 |  |  |  |

## 8. Release Gate

只有本清單所有第一版必修、決策、真實驗收與部署驗收項目全部完成，才能標記：

- [ ] **JunZan AI 第一版正式完成**

任何未完成、未決策或缺少真實驗收證據的項目，都會阻擋第一版正式完成；不得只以自動測試、health 或 test-only 部署取代正式驗收。
