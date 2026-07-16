# JunZan AI 每日房況、內部備註與月曆 V1 設計

## 目標與範圍

業者後台提供兩種共用資料的房況檢視：預設的「每日房況」與基本「月曆」。兩者都能查看並修改同一筆 `propertyId + roomTypeId + date` 房況，並新增、修改或清除該筆內部備註。

正式房況狀態維持 `available`、`closed` 兩種。滿房、口頭保留、等待訂金、維修與清潔等營運情況只記錄在內部備註，不影響 Guest 可售判定，也不進入 Guest API、AI、Safe Facts 或 LINE 回覆。

本次不加入訂單、客人資料、快速標籤、統計、特殊價格圖示、拖曳批次、CRM、金流、報表或新的權限系統。

## 資料模型

新增最小 migration `010_daily_room_notes.sql`，建立 `daily_room_notes`：

- `property_id text NOT NULL`
- `room_id text NOT NULL`
- `stay_date date NOT NULL`
- `note text NOT NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- 主鍵：`(property_id, room_id, stay_date)`
- 外鍵：`(property_id, room_id)` 指向 `room_types(property_id, room_id)`，刪除房型時採既有安全限制，不跨 property 關聯
- `note` 以資料庫 `CHECK` 限制為 1 至 1000 字元；後端仍執行型別、trim 與長度驗證

空白備註等同清除並刪除資料列，不保留無意義空字串。migration 只新增結構，不修改或插入任何正式房況與備註。

既有 `inventory_availability_days` 繼續是房況唯一來源。月曆不新增房況表、摘要表或快取表。

## API 與權限

既有管理端 `GET /api/availability/month` 延伸回傳業者專用的每日房型備註，但保留原有房況欄位相容性。每日模式與月曆模式都使用這個整月讀取結果。

新增單一管理端備註寫入路由 `PUT /api/availability/day-note`，接受 `customerId`、`roomTypeId`、`date`、`note`。同一路由處理新增、修改與清除；trim 後空白即刪除。兩種檢視都呼叫同一路由。新增與修改會由應用層明確更新 `updated_at`，清除則直接刪除該複合鍵資料列。

所有管理端路由都沿用登入 session 與後端 property scope：

- 後端以 session 選定的 property 重建／覆核 `customerId`，不只相信前端。
- `roomTypeId` 必須存在且屬於同一 property。
- 日期必須是有效的 `YYYY-MM-DD` 日曆日期。
- 備註必須是字串且 trim 後不超過 1000 字元。
- 不回應可用來推測其他 property 或房型存在性的細節。
- 錯誤統一轉為臺灣繁體中文業者訊息，不輸出 SQL、stack trace 或技術內容。

Guest 公開 API、Guest HTML／JavaScript、availability 搜尋、AI decision pipeline、knowledge items 與 Safe Facts 都不引用 `daily_room_notes`。備註只由管理端月資料與管理端寫入路由存取。

## 前端共用狀態與資料流

整月資料載入後，前端正規化為一份共用狀態：

`date -> roomTypeId -> { status, note }`

每日卡片與月曆格只從這份狀態 render。切換檢視不重新請求月份資料，因此不會因切換產生重複請求或舊資料覆蓋。修改成功後更新同一份狀態，再重繪目前檢視；切換到另一檢視會立即看到相同結果。

月份載入使用遞增 request generation；過期月份回應不得套用。每個 `date + roomTypeId` 的房況更新使用獨立序列佇列，確保快速點擊仍按發出順序寫入，最後一次操作最後完成。只有目前 revision 的成功回應能更新成功提示；失敗不顯示成功，也不清除較新的畫面狀態。

房況維持點擊後立即送出。備註使用明確的「儲存變更」按鈕，不進行額外自動儲存重構。備註儲存失敗時保留輸入草稿並提供重試；清除備註也需等後端成功後才移除標記。

## 每日房況檢視

每日房況是手機與首次進入的預設模式：

- 日期、星期、今天／明天與跨月資訊清楚。
- 每個日期一次呈現所有房型，可直接切換「可售／不可售」。
- 房型旁以小型備註圖示／圓點標示是否有內部備註。
- 點備註圖示在同頁開啟桌面側欄或手機日期卡片下方的編輯區。
- 每筆操作顯示儲存中、成功或失敗；失敗可重試。
- 今天用左側色線或淡色背景標示，不遮蓋房況資訊。

手機採日期卡片，不讓整頁橫向捲動；觸控按鈕至少約 44px。桌面採日期列與房型欄比較，必要橫向捲動只存在房況容器內。

## 月曆檢視

月曆使用相同整月資料產生七欄格狀畫面。每格只顯示日期、可售房型數、不可售房型數與備註標記，不放完整備註或其他第二階段資訊。

點日期後在同頁展開該日房型明細。明細使用與每日模式相同的房況切換、備註編輯元件與共用 mutation controller。手機明細顯示在月曆下方，不另開頁面；月曆格壓縮文字但不造成整頁橫向溢出。

桌面可用 `localStorage` 記住最後一次檢視偏好；只保存 `daily` 或 `calendar`，不保存 property、房況、備註或帳號資料。手機首次進入固定為每日房況。偏好只影響 render，不影響資料內容。

## 空白、載入與錯誤狀態

- 月份載入時保留清楚骨架／文字，不顯示舊月份為新月份。
- 無房型時說明尚無可管理房型，不生成空控制項。
- 無房況列時仍建立月份日期結構，狀態依現有服務預設規則呈現，不臆造正式資料。
- property scope 不存在、權限不足、房型不存在、日期錯誤與備註過長均由後端拒絕。
- 網路錯誤保留未儲存狀態與備註草稿，提供重試。
- 登出或 session 過期返回登入，不洩漏管理資料。

## 測試與實際驗收

自動測試涵蓋原任務列出的新增、修改、清除、空白、日期／房型隔離、property 權限、Guest／AI 隔離、房況與備註互不破壞、競態、驗證錯誤與既有完整回歸。

另驗證：

- 每日改房況後切月曆立即一致，月曆改後切每日也一致。
- 每日新增、修改、清除備註後月曆標記同步；月曆明細改備註後每日內容同步。
- 切換檢視不觸發月份重讀，快速切換不會讓舊資料覆蓋新資料。
- 桌面、390px、375px 兩種檢視均能完成主要操作，整頁無不合理橫向溢出。
- API 失敗不顯示成功，備註輸入不消失。
- Guest API、Guest 頁面、AI 與 Safe Facts 完全無備註欄位或內容。
- 測試只使用本機／測試 PostgreSQL 與 test property；不寫入正式 `nephi_home` 業務資料。

首次完成後以測試業者帳號實際操作每日與月曆模式，新增、修改、清除備註、快速切換與連續更新，重整確認 PostgreSQL 一致，模擬失敗並在桌面、390px、375px 重驗。發現阻礙主要流程、儲存狀態、手機操作、資料隔離或 Guest／AI 邊界的問題時直接修正並重跑受影響測試。

## 交付邊界

只修改正確 Node Pilot repo 與 `test-only/node-pilot-integration`。完成並驗證後才 commit、push；部署只更新程式與執行安全 migration，不寫入正式房況、價格或備註。不得修改管理者 Email、密碼、identity、session、platform admin grant、LINE、contactLink、token 或 secrets。
