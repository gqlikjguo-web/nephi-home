# JunZan AI 重大產品決策

本文件只記錄跨版本仍有效、會約束後續產品與架構的重大決策。最高原則以 [JunZan AI 核心產品憲法](JUNZAN_AI_CONSTITUTION.md) 為準。

## D-001：AI 負責理解，不負責創造事實

**決策：** AI 負責理解自然語言、上下文、修改、取消、多問題與任務規劃，並在受控範圍內自然組句。

**理由：** 自然語言具有大量口語與語意變體，適合由 AI 理解；房況、價格、設備與政策則需要可驗證、可追溯的確定性。

**長期後果：** AI 輸出必須先結構化並接受 deterministic validation，不能直接成為旅宿事實或承諾。

## D-002：Resolver 是唯一可信事實來源

**決策：** 所有對客事實與可執行結果都必須由 Resolver 根據業者授權資料產生。

**理由：** 將理解與事實判定分開，才能避免模型猜測、確保 property 隔離，並讓每個回答可測試與追溯。

**長期後果：** Composer 只能使用 Resolver 經 Response Plan 提供的可信結果；Model 不得繞過 Resolver。

## D-003：Unknown 不等於 No

**決策：** 缺少資料、低信心或無法安全解析時，結果必須是 Unknown，不能轉換成否定答案。

**理由：** 「不知道」與「沒有」是不同事實；錯誤否定會誤導客人並替業者做出未授權承諾。

**長期後果：** Unknown 必須觸發安全說明、必要補問或局部真人處理，不得被 Composer 改寫成確定結論。

## D-004：不以 regex／keyword patch 擴充自然語言能力

**決策：** 不為個別說法持續加入 regex、keyword、substring 或單句特殊 case。

**理由：** 逐句補丁無法覆蓋自然語言變體，會造成規則衝突、維護成本上升及不可預測的 routing。

**長期後果：** 語意變體由 Planner 的通用理解承接；程式規則只負責格式驗證、安全邊界與確定性解析。

## D-005：Shared Core 不因單一業者修改

**決策：** 所有旅宿共用同一套 Conversation Engine；單一旅宿差異只能存在於 property、房型、設備、規則與 alias 資料。

**理由：** 業者專用分支會破壞 SaaS 通用性、增加交叉污染風險，並讓核心能力無法一致驗證。

**長期後果：** 新業者導入不得新增專用 if／else；若需求不能以通用能力或 property 資料表達，必須先重新檢查模型邊界。

## D-006：Planner candidate 不是 canonical fact

**決策：** Planner 提取的日期、房型、人數與其他 entity 都只是候選理解；只有通過 deterministic validation、property entity resolution 與 Resolver 查詢後，才能進入 canonical request 或成為對客事實。

**理由：** 結構格式合法不代表語意正確。真實 Planner 曾把省略年份的 `7/18` 產生為 `2056-07-18`；若直接信任 candidate，會查錯資料範圍並把可回答問題錯誤轉真人。

**長期後果：** 邊界層必須以原始語意、property timezone、事件時間與允許範圍交叉驗證 candidate；無法驗證時使用 clarification 或 Unknown，不得靜默採用。

## D-007：Repository 是專案唯一永久記憶

**決策：** 專案現況、已驗收基準、重大決策、安全規則、經驗教訓與重要演進必須保存在 Repository；聊天與 Agent session 不構成專案事實。

**理由：** 對話會分散、壓縮或失去上下文，且無法像 Git 一樣審查、追溯與共同維護。

**長期後果：** 每個 Agent 任務先讀 `AGENTS.md` 指定的核心文件；重大決策、重要 bug 與正式驗收必須在同一工作流程中更新對應文件。
