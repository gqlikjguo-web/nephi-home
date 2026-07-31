# JunZan AI 精簡受控架構：底層資料契約附錄

本附錄只定義層間資料格式、追蹤、隔離與驗證。所有 ID、enum、trace、metadata 與 schema 都**沒有語意判斷權**；唯一產品規則見 [CONTROLLED_ARCHITECTURE_RULES.md](CONTROLLED_ARCHITECTURE_RULES.md)。

## 0. 唯讀 ContextSnapshot

`ContextSnapshot = { scope:{propertyId, channelId, userId}, generatedAt, cycles[] }`，其中 cycle 只含 `requestCycleId, requestKind, status, confirmedInputs, contextReuseExpiresAt`。系統只按 trusted propertyId/channelId/userId 與未過期 TTL 機械式產生；不提供舊回答文字。不得用關鍵字、regex、相似度、embedding、task type 或排序選 cycle。AI 只能引用 snapshot 明確提供的 requestCycleId；不存在、過期、ended、scope 不符或非 snapshot ID 一律驗證失敗。

## 1. AIUnderstanding 最小輸出

```ts
AIUnderstanding = {
  requests: RequestCandidate[];
  socialSignals: SocialSignal[];
  uncertainties: Uncertainty[];
  evidence: EvidenceRef[];
  contextRelationCandidates: ContextRelationCandidate[];
}
```

`RequestCandidate` 必含本輪 local `candidateIndex` 與 `evidenceRefs[]`；candidateIndex 只在同一 AIUnderstanding 輸出內對位，不得跨輪保存。AI 不得輸出 canonical 日期、state action、正式事實、資料來源、查詢計畫或最終決定。

`contextRelationCandidates` 只可表達 AI 的候選關係：

| kind | 意義 |
|---|---|
| `new_request` | 新需求 |
| `supplement_existing` | 補充既有需求 |
| `modify_existing` | 修改既有需求 |
| `end_existing` | 結束需求 |
| `relation_uncertain` | 無法確定關聯 |

每個 ContextRelationCandidate 必含 `candidateIndex, kind, candidateRequestCycleRefs[], evidenceRefs[]`。new_request 的 refs 必為空；supplement_existing、modify_existing、end_existing 必恰一個有效 snapshot cycle；relation_uncertain 可零或多個 refs、不得改 state，且由 FinalDecision 產生 clarification。AI 未提供 relation candidate 時，Validation 或 Context Manager 不得自行產生關聯。候選不得由 AI 建立、猜測或修改任何 ID；Context Manager 只能驗證 scope、未過期、唯一及不與已確認欄位矛盾，不得找「最像」舊需求。

## 2. Evidence 與 ID 生命週期

```ts
EvidenceRef = { eventId?: string; messageRef?: string; startOffset: number; endOffset: number; quote: string }
```

Evidence 必須指定 `eventId` 或不可混淆的 `messageRef`。合併 events 後候選可有多個 EvidenceRef；offset 與 quote 必可回驗來源訊息。

| ID | 用途 | 不得用於 |
|---|---|---|
| `turnRequestId` | 本輪去重後候選 | 跨輪語意判斷 |
| `requestCycleId` | 跨輪同一邏輯需求 | 判斷客人意圖 |
| `pendingRequestId` | 缺欄附屬狀態 | 取代已回答 cycle |
| `formalRequestId` | 一次可執行正式請求 | 失敗週期或語意判斷 |
| `operationId` | 一次查詢操作的 trace／去重 | 變更 requestKind |
| `factId` | 正式 fact reference | 產生新事實 |

`RequestCycle`：`requestCycleId, requestKind, status, originTurnRequestId, sourceTurnRequestIds[], confirmedInputs, latestFormalRequestId?, createdAt, updatedAt, contextReuseExpiresAt`。`PendingRequest`：`pendingRequestId, requestCycleId, missingFields[], expiresAt`。Pending 只代表缺欄；answered cycle 可在集中設定的 24 小時內提供 context，ended/expired cycle 不可承接。

## 3. 欄位資料與正式請求

```ts
InputField = {
  value: unknown | null;
  valueStatus: 'missing' | 'uncertain' | 'invalid' | 'confirmed';
  provenance: 'explicit' | 'context' | 'defaulted' | 'derived' | null;
  sourceTurnRequestIds: string[];
  ruleRef?: string;
  derivedFromFieldRefs?: string[];
}
```

`missing` 必為 `value:null, provenance:null`。`uncertain`／`invalid` 保留來源但不得提供 context。`confirmed` 僅可使用 explicit/context/defaulted/derived provenance；defaulted 必有 `ruleRef`，derived 必有 `ruleRef` 與 `derivedFromFieldRefs[]`。

`FormalRequest`：`formalRequestId, requestCycleId, originPendingRequestId?, sourceTurnRequestIds[], requestKind, propertyId, inputs, contextRefs`。每個影響查詢目標的 input 都使用 InputField。這些欄位只記錄已確認資料，不得推論意圖。

## 4. Trusted property scope、Context、Temporal 與 Query

`propertyId` 唯一來源是 transport／identity scope 的 trusted 頂層欄位；AI 不得產生，亦非 InputField 或 registry exactRequiredFields。FormalRequest、QueryPlan operation、ResolvedResult 與 Fact 必繼承並驗證同一 propertyId；任一不一致即拒絕，不得自動修正。所有 capability 強制使用 FormalRequest 的 trusted property scope。

`ApprovedTemporalContext`：`turnRequestId, sourceRequestCycleId, sourcePendingRequestId?, sourceFormalRequestId?, approvedFields[]`。每個 approved field 是 confirmed canonical InputField。TemporalResult 只能使用其 `requestRef` 完全相符的 ApprovedTemporalContext；不符、候選不唯一或已過期即拒絕沿用。

`QueryPlan`：`status, items[], operations[]`。每個 operation：`operationId, formalRequestId, propertyId, capabilityVersion, source, operation, inputs, freshnessPolicy`。第一版一個 FormalRequest 恰一個 operation。

`ResolvedResult`：`status, items[]`。每個 item：`formalRequestId, operationId, status: facts|no|unknown|temporary_error|permanent_error, facts[], sourceMetadata?, errorClassification?, reasonCode?`。一個 FormalRequest 恰一個 item；個別錯誤不得污染其他 item。

## 5. Facts、回覆與 delivery

```ts
Fact = {
  factId: string;
  factType: string;
  value: unknown;
  sourceMetadata: {
    propertyId: string; sourceType: string; queriedAt: string; resultStatus: string;
    sourceId?: string; sourceVersion?: string; effectiveFrom?: string; effectiveTo?: string;
  };
}
```

Operation metadata 不得取代 Fact metadata。`FinalDecision.items[]` outcome 只可為 `reply|clarification|handoff|no_reply`，並使用 `factRefs[]` 而非複製 facts。ResponsePlan 的 `allowedFactRefs[]` 是 Composer 唯一可表達的事實集合；不存在、未核准或 propertyId 不符的 fact reference 一律拒絕。

## 6. Capability registry

每筆 entry 固定包含：`requestKind, exactRequiredFields, optionalFields, needsDate, needsGuests, contextReuse, capability, source, freshness, resultShape, unknownNoError, handoffEligibility`。不得省略 exactRequiredFields 或使用模糊描述。

| requestKind | exactRequiredFields |
|---|---|
| availability | checkIn, checkOut |
| available_dates | range: `{startDate, endDate}` |
| room_type | roomTypeKey |
| room_number | roomNumber |
| capacity | roomTypeKey, guests |
| bundle | bundleKey |
| room_price | roomTypeKey, pricingScope=`general` |
| dated_room_price | roomTypeKey, checkIn, checkOut |
| bundle_price | bundleKey, pricingScope=`general` |
| dated_bundle_price | bundleKey, checkIn, checkOut |
| amenity | amenityKey: `parking|bbq|pool` |
| policy | policyKey: `location|checkin_checkout|lodging_rule` |

booking_action 第一版為 unsupported／handoff-only，不屬於正式 executor registry。Registry 只能由已確認 requestKind 選 capability，不得新增需求、改變 requestKind 或重新理解客人文字。

## 7. 補齊 enum

| enum | 合法值 |
|---|---|
| RequestCycle.status | `active|answered|handoff|ended|expired` |
| QueryPlan.status | `ready|not_required|mixed` |
| ResolvedResult.status | `facts|no|unknown|temporary_error|permanent_error|not_executed|mixed` |
| contextReuse | `none|same_cycle_only|snapshot_validated` |
| freshness | `per_turn|catalog_ttl_5m|static_authorized` |
| unknownNoError | `unknown_not_no|authoritative_no_only|classified_error` |
| handoffEligibility | `never|explicit_request|manual_operation|second_temporary_error` |

enum 只規範資料合法值，不能產生語意判斷。
