# subagent options 正規化 — 審查紀錄

## Round 1 — 完整 diff 自審與雙重唯讀審查（2026-10-13）

**範圍**：repo `/Users/scl/web/pi-agents-guard`，branch `fix/subagent-options-normalization`，base `main`／審查開始時 HEAD `cfb08a1`。受審為未提交的 tracked 變更（7 檔）與新增 `openspec/changes/fix-subagent-options-normalization/`。主 agent 已完整重讀 `src`／`test` diff 與三份文件 diff。

**雙重唯讀 review**：pi-subagents parallel workflow，mission `22f6dbcf-ce76-4e31-96d1-ab53a8e6c1d1`；`review-main`（child `ad154543-54bb-4967-948e-ca619bc5d5cb`）與 `review-counterpart`（child `e9641d08-cbee-4ef5-831a-93f0b060dc9f`）皆 completed，未傳 `model`。兩者皆唯讀，未修改 repo、未 commit、未派發 subagent。

受審 blob SHA-256（審查開始時）：

- `src/modules/subagent-policy.ts`：`0cf11d1e849bfa956f09dc5b586e1bc0cdbffb676e819081f58cb33b27ebe411`（finding 修正前；修正後見下方 Round 1.1）
- `src/index.ts`：`36ceddf303da88dad0ccfce8ad47fc0c4f72f6838a936f23d3dcf884222aa7fb`
- `test/subagent-policy.test.ts`：`8a8b65458ad6f913800cc6405894dcdf650247660683424d15fcb16c4bc91807`（修正前）
- `test/extension.test.ts`：`53241a1d0155b919d3d6d22a00977787240192f04bd04d2c6e7c43a416f75d32`

### 兩位 reviewer 共同確認（非 findings）

- 合併語意 `{ ...input, ...definedEntries(options) }` 只在「上游 `flattenSubagentToolOptions` 會以 conflict 檢查拒絕」的輸入上偏離，不存在「guard 看一層、executor 看另一層」的可執行繞道。
- capabilities 事實的四項前置條件未被放寬；沒有新增放行路徑。
- 8 個 `nativeOnlyOptions` 與上游 `SubagentOptionProperties` 對照正確（`model` 為頂層專屬，其餘 7 個為真正的 `options` 成員）；規則 3 的收緊是恢復既有防線。
- `Object.entries` 不枚舉 `__proto__`，且無程式讀取 `view.__proto__`；無 prototype pollution 可達路徑。
- `completion.observeToolResult` 仍收到未經正規化的原始 `input`。

### Findings 與裁決

- **[CODE] N — 採納並修正（P2）。** `src/index.ts:193-203` 的 `handleToolResult` 不在 `guarded()` 內（對照 `handleToolCall` 的 `guarded("subagent-policy", …)`），而 `normalizeSubagentInput` 以 `Object.entries(options)` 列舉整個 `options`，比原本只讀兩個具名屬性的程式碼有更廣的拋錯面；且 `completion.observeToolResult` 是同一函式的最後一句，一旦正規化拋錯就會被跳過，該次 write／porcelain 觀察遺失。design `Failure Handling / Security`（`design.md:85`）明文宣稱「正規化不拋錯」，所以這不只是理論風險，而是實作與已凍結設計不一致。
  - 修正（RED→GREEN）：`normalizeSubagentInput` 的列舉改為 `try`／`catch`，例外時回退「只讀頂層」並回傳原 `input`（`src/modules/subagent-policy.ts:60-69`）。新增測試 `falls back to the top level when options cannot be enumerated`（`test/subagent-policy.test.ts` 的 `normalizeSubagentInput` describe），以 `Object.defineProperty` 的 enumerable throwing getter 觸發。
  - RED：`npm test -- test/subagent-policy.test.ts` exit 1＝`Tests 1 failed | 24 passed (25)`，失敗為 `Error: hostile getter`。GREEN：同一命令 exit 0＝25 passed。
  - 修正後重新驗證：`npm test` exit 0＝**421 tests／18 files**；`npm run typecheck` exit 0；`npm run lint` exit 0（46 files）；`git diff --check` exit 0；`src/modules/subagent-policy.ts` 與 `test/subagent-policy.test.ts` 的 LSP 診斷 0（clean=2）。
- **[CODE] N — 不採為 code finding（P2）。** `.gitignore` 的 `*.local.md` 出現在 working tree diff，但 `tasks.md` 已明示它「另行處理，不屬本 change」。這是 repo hygiene（scope-ledger 檔不入版控），checkpoint 只會 stage 本 change 的檔案；不以 finding 處理。
- **[CODE] N — 不採納（P2）。** `review-counterpart` 建議正規化視圖比照上游 destructure 掉 `options` 鍵。design D2 明文決定「回傳值仍保留原始 `options` 鍵，但沒有任何規則讀它」，且 `EXECUTION_KEYS`／`nativeOnlyOptions` 皆不含 `options`。移除屬行為中性，但會偏離已凍結的設計描述並擴大 diff；維持原狀並在此記錄理由。

### 界線

- 本輪只跑本機 Node `v22.23.3`／Darwin arm64 的單元與 harness 測試，未啟動真實 agent session、未做 CLI／跨平台驗收。
- 兩位 reviewer 皆回報「OK with notes」，主 agent 已完成上述逐項裁決；沒有未處置的 P0／P1。

## Phase 6 — Reconciliation Gate（2026-10-13）

| 項目 | 結果 | 證據 |
| --- | --- | --- |
| C1 Y 項路由 | ✅ verified | `review-notes.md` 全部為 `[CODE] N`（3 項），無 `[REQUIREMENT] Y`／`[DESIGN] Y`／`[CONSTITUTION] Y`；採納的修正只落在 code 與測試，`design.md:85` 的「正規化不拋錯」契約因此成立。 |
| C2 Constitution 隔離 | ✅ verified | 完整重讀 `proposal.md`、delta spec、`design.md`；`AGENTS.md:88`／`:91`／`:92` 只作動機引用，未把跨專案規則寫入 feature spec；無 constitution item。 |
| C3 `tasks.md` 未變 | ✅ verified | `git status --short openspec/changes/fix-subagent-options-normalization/` 無輸出；`git diff -- …/tasks.md` 空；checkpoint commit `6620e9d` 後未再修改。 |
| C4 strict validation | ✅ verified | workflow pre-check `VALID` exit 0；`openspec validate fix-subagent-options-normalization --strict --no-interactive` exit 0。 |
| C5 clean rewrite | ✅ verified | 逐份完整讀 proposal／delta spec／design；無「Round N 修訂」等 changelog 語言，無矛盾段落，不依賴本檔即可理解；`tasks.md` 保持執行歷史。 |
| C6 coverage / deferred | ✅ verified | 四面 coverage 完成（無 REQUIREMENT／DESIGN／CONSTITUTION Y；所有 feedback 有 disposition；`tasks.md` 未改）。延後項目：無。 |

裁決：`verified`。
延後項目：無。

