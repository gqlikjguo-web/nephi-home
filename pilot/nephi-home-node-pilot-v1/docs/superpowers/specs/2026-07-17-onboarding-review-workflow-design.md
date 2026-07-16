# JunZan AI Onboarding 審核流程修正設計

## 目標與範圍

修正平台管理者退回補件、補件 token、Email 通知、成功／失敗畫面，以及新旅宿／既有旅宿核准分流。只處理 Onboarding 審核；不修改正式 `nephi_home` 業務資料、正式帳號、密碼、權限、LINE、contactLink 或 secrets。

## 已確認問題

- 非 `AppError` 的例外一律被 `server.js` 顯示為 `Test-only server error`，管理者無法判斷原因。
- 退回 transaction 與 transaction 後的 Email delivery 回寫沒有明確結果邊界；後置通知錯誤可能讓已完成的退回看似失敗。
- `reviewOnboarding` 對已是 `changes_requested` 的案件仍可能旋轉 token，未依新規格回傳 409。
- 舊補件 token 不會在重新送審時立即失效；再次退回前也未保證只剩一個有效 token。
- API 退回成功後未直接回傳本次補件連結，前端必須再呼叫一次 token rotation。
- 前端退回後重新載入原案件卡，沒有不可重複操作的完成結果。
- 核准 UI 只有隨機新 propertyId 與可編輯 `owner`；後端只有建立新 property，沒有受控套用既有 property。

## 退回補件設計

`POST /api/admin/onboarding/applications/:id/request-changes` 僅接受 `submitted` 或 `resubmitted`。trim 後空白原因回傳 400。Provider 在同一 PostgreSQL transaction 中：

1. `FOR UPDATE` 鎖定申請。
2. 驗證狀態。
3. 寫入 `changes_requested` 與 review note。
4. 刪除該 application 所有既有 resume tokens。
5. 寫入唯一的新 token hash 與 30 天期限。
6. 建立 Email delivery，未設定 Resend 時記為 `not_configured`。
7. 任一步驟失敗全部 rollback。

API 回應包含 application、只在本次回應出現的 raw resume URL、期限與 Email 狀態。資料庫不保存 raw token。Email 寄送在 transaction 完成後執行；寄送或 delivery 狀態回寫失敗不得推翻退回結果。

重新送審時在同一 transaction 將狀態改為 `resubmitted` 並刪除該 application 的 resume tokens，確保補件網址立即失效。

## 核准與 property 分流

審核頁明確要求選擇：

- `new`：建立新旅宿，管理者確認符合格式且不存在的新 propertyId。
- `existing`：平台管理者明確選擇已存在的 target propertyId。

目前 repository 沒有受控套用既有 property 的資料合併能力，因此 `existing` 模式只做存在性與權限驗證，最後以 409 `EXISTING_PROPERTY_APPLY_NOT_AVAILABLE` 安全阻止，不修改 target、不建立替代 property。UI 不預設 `nephi_home`，也不依民宿名稱自動匹配。

## Email identity 與 legacy membership key

現行 schema 的 `admin_user_properties(property_id, username)` 外鍵必須指向 `admin_users(property_id, username)`；`property_admin_invitations.username` 也仍為 NOT NULL。因此新 property 邀請在不重做整套 auth schema 的前提下，仍需要一個內部相容鍵。

此鍵由系統以 applicationId 產生、不可由管理者輸入、不顯示於業者 UI，且不是登入帳號。對應 `admin_users.password_hash` 使用明確的 disabled credential marker；舊 username 登入路徑必須拒絕 marker，不呼叫密碼驗證。實際登入仍由 `admin_identities` Email identity 完成。

邀請兌換時：

- 新 Email：建立 Email identity，將新 property membership 連到該 identity。
- 已有 Email identity：保留原 Email 與 password hash，只新增該 property membership。
- compatibility `admin_users` row 只建立一次，永遠保持 disabled，不授予 platform admin。

這是現行外鍵造成的暫時相容層；未來若 migration 移除 `admin_user_properties.username` 與相關 legacy foreign key，應一併移除。

## 管理端介面

- 退回原因必填；送出期間停用案件內所有操作。
- 成功後顯示獨立結果卡：民宿、原因、狀態、Email 狀態、複製補件連結、返回清單、查看案件。
- 失敗保留原因與案件畫面，顯示繁體中文錯誤並允許重試。
- 移除 `owner` 欄位，改顯示唯讀邀請 Email。
- 核准與退回分區；既有 property 模式清楚標示目前不可套用。
- 桌面、390px、375px 無整頁橫向溢出，觸控按鈕至少 44px，不依賴 hover。

## 錯誤與安全

- 已退回、已核准或非等待審核狀態回傳 409。
- 未知 500 不再顯示 test-only 文案、SQL、stack trace 或 provider 細節。
- 平台審核 API 維持 session 與 platform admin 驗證。
- 前端防重複點擊只是 UX；正確性由後端 row lock 與狀態驗證保證。

## 測試與驗收

新增 PGlite 整合測試覆蓋退回 transaction、token hash／rotation／expiry、Email 未設定與失敗、rollback、重複操作 409、既有 property 安全阻止、new property 回歸、disabled legacy login、identity 不重複與不升權。完整既有回歸後，以 test platform admin／test submission 驗收桌面、390px、375px；不得對正式 `nephi_home` 執行退回或核准。
