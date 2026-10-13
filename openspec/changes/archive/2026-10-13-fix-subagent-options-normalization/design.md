# Design

**Change:** `fix-subagent-options-normalization`
**Approved spec:** `openspec/changes/fix-subagent-options-normalization/specs/subagent-dispatch-policy/spec.md`（sha256 `4128e956113cdffc4c370e93d5e9759a4538047fa0ea87e78351b280b17ee8c8`）
**Approved proposal:** `proposal.md`（sha256 `583dfd84b52bfef638bdd00bda37367e0b0f96eaa5ea80b3a7d611ac35d5248b`）

## Context

pi-subagents 0.77.0 起，model-facing `subagent` 工具只把 `agent`、`task`、`workflow`、`args`、`async`、`model`、`cwd`、`worktree`、`output`、`action`、`id`、`message` 放在頂層，其餘（含 `capabilities`、`context`、`acceptance`、`outputSchema`、`toolBudget`、`fast`、`skill`、`mission`）收在單一 `options` 物件；上游在真正執行前才用 `flattenSubagentToolOptions` 攤平。Pi 把模型原始參數原樣交給 extension 的 `tool_call`／`tool_result`。

agents-guard 目前直接讀頂層欄位（`src/index.ts` 的 capabilities 觀測、`src/modules/subagent-policy.ts` 的三條規則），因此同一份政策在兩種形狀下得到不同結果：規則 1 的派發前置檢查無法被巢狀 list 解鎖（合法派發誤擋），規則 3 看不到 `options` 內的 native-only 選項（違規派發漏擋）。動機與影響面見 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 三條規則與 capabilities 事實觀測對扁平與巢狀 `options` 兩種形狀給出相同判定。
- 讓「輸入形狀解讀」只有一個 owner、一個實作，未來上游再漂移時有單一核對點。
- 維持 `decideSubagentCall` 的純函式契約與 `Runtime` 公開介面不變。
- 恢復 external CLI runner 的 native-only 選項防線，同時不再誤擋合法派發。

**Non-Goals:**

- 不改規則門檻、pattern 預設、`config` 合併、模組開關或 `block` reason 格式。
- 不引入 JSON schema validator、通用 param normalizer、對 pi-subagents 的版本偵測或 feature flag。
- 不改 hard-deny 順序、writer advisory、completion、git-evidence。
- 不改 `package.json`／`package-lock.json`／CI，不新增 production dependency。

## Decisions

### D1. 正規化契約落在政策模組內，由 `decideSubagentCall` 入口套用

`src/modules/subagent-policy.ts` 新增並 export 純函式：

```ts
export function normalizeSubagentInput(
  input: Record<string, unknown>,
): Record<string, unknown>;
```

`decideSubagentCall` 在入口呼叫一次，三條規則只讀正規化後視圖；`src/index.ts` 的 `handleToolResult` 以同一個 helper 取得 capabilities 事實。`handleToolCall` 不需改動。

理由：`Runtime.handleToolCall`／`handleToolResult` 是公開且有直接測試（`test/integration.test.ts`）的介面，其行為不應取決於某個 adapter 先做過處理。契約落在政策模組，任何直接呼叫 Runtime 或政策的程式都能吃模型原始參數。

替代方案：

- **各規則內分別讀 `input.options?.[key]`**：三條規則加事實觀測共四處，下一個欄位或形狀改變時容易再漏一處；否決。
- **只在 `src/extension.ts` adapter 攤平**：能修 wiring，但直呼 Runtime 的呼叫端（含既有整合測試）會得到不同語意，且公開介面出現未文件化的前置條件；否決。
- **依 pi-subagents 版本切換形狀**：多一個要維護的外部事實；扁平與巢狀本來就能同時安全接受；否決。

### D2. 合併語意：`options` 覆寫頂層，但丟棄值為 `undefined` 的選項鍵

正規化等價於 `{ ...input, ...definedEntries(options) }`，其中 `definedEntries` 只保留值不是 `undefined` 的鍵。`options` 非物件（`null`、陣列、字串、數字）時視為沒有 options，回傳原物件。helper 回傳新物件，不修改傳入的 `input`；回傳值仍保留原始 `options` 鍵，但沒有任何規則讀它。

理由：`{ ...topLevel, ...options }` 會讓 `{ acceptance: {...}, options: { acceptance: undefined } }` 這種輸入把頂層值遮蔽成 `undefined`。上游對同名不同值會直接報錯，所以該呼叫目前不可能執行；但 guard 的健全性不應依賴「上游會擋」這個耦合。丟棄 `undefined` 讓合併後的單一視圖永遠保留頂層的非 `undefined` 值，規則 3 在任何一層有值時都會擋。

與上游的唯一差異只出現在上游本來就會拒絕的輸入上，因此不會造成「guard 看一層、executor 看另一層」的可執行分歧。

### D3. capabilities 事實的觀測條件不變，只換視圖

事實仍要求四項同時成立：`toolName === "subagent"`、`action === "list"`、`capabilities === true`、`isError !== true`。只有「從哪一層讀 `capabilities`」改變。管理／控制呼叫完全不受影響；失敗或非 capabilities 的 list 不會解鎖。

### D4. 只展開單層，且不改其他模組看到的輸入

`options` 是上游唯一的巢狀層。helper 不遞迴、不驗證、不改寫：`block` reason、log、hard-deny 與 `completion.observeToolResult` 看到的仍是原始 input。`EXECUTION_KEYS` 的 `workflowScript`／`workflowScriptPath` 保留為 legacy 判定鍵，讓 0.77 之前的 scripted caller 維持原本的「執行型」分類。

## Data Flow

```text
tool_call   → Runtime.handleToolCall(toolName, rawInput)
              → decideHardDeny(toolName, rawInput)            // 原始 input，順序不變
              → decideSubagentCall(normalizeSubagentInput(rawInput), facts, opts)
                  rule 1: capabilitiesListed + isExecutionCall(view)
                  rule 2: model / agent / task（頂層欄位）
                  rule 3: agent + nativeOnlyOptions(view)
              → Decision(block | pass)

tool_result → Runtime.handleToolResult(toolName, rawInput, isError, content)
              → normalizeSubagentInput(rawInput) → capabilitiesListed 事實
              → completion.observeToolResult(toolName, rawInput, isError, content)  // 原始 input
```

## Failure Handling / Security

- 正規化不拋錯：任何非物件 `options` 都走「只讀頂層」路徑，維持既有 fail-open 邊界；guard 自身錯誤仍由 `guarded()` 的失敗計數吸收。
- 規則 3 在合併視圖上判定，因此頂層、`options` 或兩者同時提供 native-only 選項都會 block，reason 逐欄位列出違規鍵（訊息格式不變）。
- 若 guard 看到上游其實會拒絕的 `options` 鍵（例如 `options.model`），最壞情況是提前 block 一個本來就會失敗的呼叫，不構成放行繞道。
- 行為收緊是刻意的：external CLI agent 帶 native-only 選項原本漏放，修正後依 `AGENTS.md:92`（MUST）block，不提供單次放行。這是恢復既有防線，不是新政策。
- 正規化只影響 subagent-policy 模組與 capabilities 事實，其他模組的輸入視圖與判定順序不變。

## Compatibility Matrix

| 輸入形狀 | 來源 | 修正前 | 修正後 |
| --- | --- | --- | --- |
| 頂層 `capabilities:true` | 0.77 前 session、RPC／slash／workflow caller | 解鎖 | 解鎖（不變） |
| `options.capabilities:true` | 0.77 起的 model 呼叫 | 不解鎖（誤擋） | 解鎖 |
| 頂層 native-only 選項 + external agent | 舊 caller | block | block（不變） |
| `options` native-only 選項 + external agent | 0.77 起的 model 呼叫 | pass（漏擋） | block |
| `options` 為 `null`／陣列／非物件 | 異常 caller | 只讀頂層 | 只讀頂層（明確化） |
| `options` 用 `undefined` 遮蔽頂層值 | 異常 caller | 視頂層值 | 保留頂層值（比上游嚴格，且上游會拒絕該輸入） |

## Testing / Requirement Coverage

| 已核准 requirement | 設計決策 | 驗證策略 |
| --- | --- | --- |
| Dispatch prerequisite observation | D1、D3 | `test/extension.test.ts`：巢狀 `options.capabilities` 成功解鎖、`isError` 不解鎖、頂層舊形狀仍解鎖；`test/subagent-policy.test.ts` 的 facts 邊界。 |
| Input shape binding | D1、D2、D4 | `test/subagent-policy.test.ts`：同一 native-only 選項在頂層與 `options` 得到相同 block；`options: null`／`[]` 不改變頂層判定；`options` 的 `undefined` 不能遮蔽頂層值。 |
| High-risk task is not silently downgraded | D1、D4 | 既有規則 2 案例保留，確認正規化未改變其餘判定與 `reason`。 |
| External runner rejects native-only options | D1、D2、D4 | 新增 `options` 形狀的 block 與 reason 欄位斷言；負向控制以停用 helper 證明測試有防護力。 |

`decideSubagentCall` 維持純函式，多數案例不需真實 child、網路或 fs；wiring 案例沿用 `test/helpers/extension-harness.ts`，不啟動真實 agent session。最終驗證入口為 `npm test`、`npm run typecheck`、`npm run lint`、變更檔 LSP 與 `git diff --check`。

## Risks / Trade-offs

- **[上游再次改形狀]** helper 會再次脫節 → Mitigation：測試同時釘住扁平與巢狀兩種形狀，helper doc comment 記錄對應上游檔案（`pi-subagents` `src/extension/subagent-options.js` 與 `src/extension/schemas.js`），下一次升級有明確核對點。
- **[行為收緊造成摩擦]** 一直用 `options` 傳 native-only 選項的既有 session 會開始被 block → Mitigation：非使用者失誤，屬 MUST 防線；reason 逐欄位列出違規項；文件同步說明。
- **[與上游語意的刻意差異（D2）]** 丟棄 `undefined` 與上游原樣攤平不同 → Mitigation：差異只落在上游會拒絕的輸入；以測試固定此行為並在 design 記錄理由。
- **[正規化掩蓋結構錯誤]** 未來若出現非預期的巢狀層 → Mitigation：只展開單層；helper 不遞迴、不驗證，非物件一律忽略，不新增放行路徑。

## Migration Plan

無資料或設定遷移，部署即生效。文件同步 `docs/design.md` §5.2、`README.md` 的規則 1 段落與 `docs/user-guide.md` 的能力查詢範例（改為 `{"action":"list","options":{"capabilities":true}}`，並註明扁平形狀仍相容）。回退方式為還原 `src/modules/subagent-policy.ts`、`src/index.ts`、測試與文件；回退會重新引入本次修掉的誤擋與漏擋，不能宣稱安全。

## Open Questions

無。兩個需要裁決的設計點（合併語意、正規化位置）已於 Phase 2 由使用者選定 D1／D2。
