# JunZan AI 精簡受控架構：測試與驗收規格

本文件只定義驗證不變量；產品規則唯一來源是 [CONTROLLED_ARCHITECTURE_RULES.md](CONTROLLED_ARCHITECTURE_RULES.md)。本輪不新增或修改測試程式。

## 核心不變量

1. AI 是第一個語意理解單位；程式不得用關鍵字、regex、task type、固定句型或例外分支重新理解客人。
2. 每個 AI 候選都能以 event/message、offset、quote 回驗；burst 及跨 event evidence 不得串錯。
3. AI 不得產生 canonical date、state action、正式事實、查詢路徑或最終決定。
4. Context、Temporal、FinalDecision 各有唯一權威；Context 只驗證 AI 提供且唯一有效的候選關聯。
5. 缺欄可多輪澄清；無關 pending 不主動打擾、清除或阻擋新需求；已回答且未過期 cycle 可承接省略追問。
6. 新的非法／模糊日期不沿用舊日期；同 canonical 日期的不同說法不換 cycle；有效改變查詢目標才換 cycle。
7. 多問題可局部 reply、clarification、handoff、no-reply，且不互相覆寫；handoff 僅限必要部分。
8. 正式資料只按 propertyId 從授權來源讀取；Unknown 不等於 No；資料、state、event claim 與 cache 均隔離。
9. 每個可說 fact 都有可驗證來源；FinalDecision、ResponsePlan、Composer 只能用核准 fact refs。
10. registry 只對已確認 requestKind 選 capability；缺 exact required-fields 或模糊 registry entry 必拒絕。
11. 一個 FormalRequest 僅一個 operation 與一個結果 item；operation/result/fact 的來源與 property scope 必可驗證。
12. 純社交、no-reply、缺欄澄清、無效理解與不支援需求不得做無關 Resolver 查詢。

## 驗收範圍

- 合同／schema：未知控制欄位、scope、來源、ID 對位、enum 與事實引用均拒絕錯誤組合。
- 語意泛化：可見測試用等價、不變與對比類別；真正 held-out 語句由外部審查提供，不得進 prompt、程式或 fixtures。
- 整合：signed webhook、event claim、burst 合併、PostgreSQL provider、property isolation、完整分類後 regression 與替代契約／端到端測試。
- 真實 test-only LINE：使用驗收時仍在未來的日期，驗證房況、設施、多問題、多輪與安全回覆；不得切正式 LINE。

## 完成門檻

完整 `npm test` exit 0，所有上述不變量、test-only webhook 與人工驗收通過後，才可考慮建立回退點。部署與正式切換須另行明確授權。
