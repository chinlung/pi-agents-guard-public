# Implementation Tasks

**Change:** `fix-subagent-options-normalization`
**Spec:** `openspec/changes/fix-subagent-options-normalization/specs/subagent-dispatch-policy/spec.md`
**Design:** `openspec/changes/fix-subagent-options-normalization/design.md`
**Execution:** inline sequential、單一 writer，全程 TDD；不逐 checkbox 派發 implementer。
**Approval:** 需求＝`proposal.md` sha256 `583dfd84b52bfef638bdd00bda37367e0b0f96eaa5ea80b3a7d611ac35d5248b` 與 delta spec sha256 `4128e956113cdffc4c370e93d5e9759a4538047fa0ea87e78351b280b17ee8c8`（已核准）；設計＝`design.md` sha256 `8daf1eec69b12311aba735330d8e29ed8d9fa07c147419eb0d05495acabda057`（已核准）。**tasks 本身尚未核准；核准前不進 Phase 4。**

## Global Constraints

- 執行 cwd＝`/Users/scl/web/pi-agents-guard`；使用者已授權就地建立 feature branch `fix/subagent-options-normalization`。同一 worktree 只允許一個 writer，reviewer 唯讀。
- 只改 `src/modules/subagent-policy.ts`、`src/index.ts`、`test/subagent-policy.test.ts`、`test/extension.test.ts`、`docs/design.md`、`README.md`、`docs/user-guide.md`。`.gitignore` 的 `*.local.md` 已另行處理，不屬本 change。
- 不改 `package.json`／`package-lock.json`／CI、不新增 dependency、不改公開 `Runtime`／`RuntimeDeps`／`createRuntime` 介面、不動 hard-deny／writer／completion／git-evidence 的判定。
- 驗證以原始命令 exit code 判定；顯示與判定分開（必要時先存輸出並保留 `$?`），不讓 `grep`／`tail` 管線遮蔽失敗。
- 每項依 RED → GREEN → REFACTOR，並以負向控制證明測試有防護力：刻意破壞守護行為必須讓指定 assertion 失敗，精準還原後必須轉綠。
- 現有授權不含 commit／push／merge／安裝／發布／archive；完成證據以具名檔案、命令與 exit code 記錄。

## 需求 → 設計 → Tasks

| Requirement | Design 決策 | Tasks |
| --- | --- | --- |
| Dispatch prerequisite observation | D1、D3 | 3、5 |
| Input shape binding | D1、D2、D4 | 2、5 |
| High-risk task is not silently downgraded | D1、D4 | 2 |
| External runner rejects native-only options | D1、D2、D4 | 2、5 |

依賴：`1 → 2 → 3 → 4 → 5`。

## 1. Baseline 與 feature branch

**Paths / symbols:** repo root；不改任何 tracked 內容。

- [x] 1.1 執行 `git switch -c fix/subagent-options-normalization`，確認 `git branch --show-current` 為新分支、`git status --short` 仍只有 `M .gitignore` 與 `?? openspec/changes/fix-subagent-options-normalization/`（不夾帶其他檔案）。
  - 證據：`branch=fix/subagent-options-normalization`；`git status --short` 僅上述兩項。
- [x] 1.2 建立 baseline：個別執行 `npm test`、`npm run typecheck`、`npm run lint`，記錄測試檔數／案例數與各自 exit code。既有紅燈先辨識並寫入本 task，不可修改測試掩蓋。完成證據＝三串命令與 exit code。
  - 證據：`node_modules` 原本不存在，先 `npm ci`（exit 0，179 packages；回報 4 個既有 vulnerabilities，未處理）。`npm test` exit 0＝18 files／411 tests passed；`npm run typecheck` exit 0；`npm run lint` exit 0（46 files）。無既有紅燈；`git status --short` 未新增 tracked 變更。

## 2. 正規化 helper 與規則 3（RED → GREEN → REFACTOR）

**Paths / symbols:** `src/modules/subagent-policy.ts`（新增 `normalizeSubagentInput(input: Record<string, unknown>): Record<string, unknown>`；`decideSubagentCall` 入口套用）、`test/subagent-policy.test.ts`。
**I/O interface:** 輸入＝模型原始 subagent input（扁平或巢狀 `options`）；輸出＝新的 `Record<string, unknown>`，含 `options` 鍵但不被任何規則讀取；`options` 非物件時原樣回傳。`decideSubagentCall(input, facts, opts) → Decision` 簽章不變。

- [x] 2.1 RED：在 `test/subagent-policy.test.ts` 的規則 3 區塊新增（`facts({ capabilitiesListed: true })`、`opts` 同檔既有常數）：
  - `{ agent: "codex-exec", task: "review", options: { acceptance: { level: "checked" } } }` 應 `block`，`reason` 含 `acceptance`；
  - `{ agent: "codex-exec", task: "review", options: { context: "fresh" } }` 應 `block`；
  - `{ agent: "codex-exec", task: "review", options: null }` 與 `options: []` 應仍 `pass`，且不拋錯；
  - `{ agent: "codex-exec", task: "review", acceptance: { level: "checked" }, options: { acceptance: undefined } }` 應 `block`（D2 遮蔽防護）。
  執行 `npm test -- test/subagent-policy.test.ts`。預期前兩案因「現行只讀頂層、回 pass」而失敗，後兩案既有行為下即通過。記錄失敗案例與 assertion 位置。
  - 證據：`npm test -- test/subagent-policy.test.ts` exit 1＝`Tests 2 failed | 20 passed (22)`。失敗正是 `blocks a native-only option nested in options`（line 182 `expected 'pass' to be 'block'`）與 `blocks a context option nested in options`（line 195）；非物件 options 與遮蔽案如預期先通過。
- [x] 2.2 GREEN：實作 `normalizeSubagentInput`（單層展開、只保留值非 `undefined` 的 `options` 鍵、不修改傳入物件；doc comment 指向 `pi-subagents/src/extension/subagent-options.js` 與 `src/extension/schemas.js`），並在 `decideSubagentCall` 入口套用。`npm test -- test/subagent-policy.test.ts` 全綠；`npm run typecheck` exit 0。
  - 證據：`npm test -- test/subagent-policy.test.ts` exit 0＝`Tests 22 passed (22)`；`npm run typecheck` exit 0。`decideSubagentCall` 改為在入口取 `view = normalizeSubagentInput(input)`，三條規則只讀 `view`。
- [x] 2.3 REFACTOR＋負向控制：確認規則 1／2 案例結果與 `reason` 未變、helper 不修改輸入物件（以輸入物件前後比較斷言）。負向控制：暫時把 helper 改成樸素 `{ ...input, ...options }`，2.1 的遮蔽案必須失敗；暫時停用 helper，前兩案必須失敗。兩者精準還原後同一命令 exit 0。完成證據＝RED 失敗輸出、GREEN 通過數、兩次負向控制的 assertion 與還原後 exit code。
  - 證據：新增 `normalizeSubagentInput` 單元測試（非變異＋非物件回傳），全檔 `Tests 24 passed (24)`。負向控制 A（樸素 `{ ...input, ...options }`）exit 1，唯一失敗＝`does not let options mask a top-level native-only option`；負向控制 B（`return input`）exit 1，失敗＝兩個巢狀規則 3 案例＋`merges options over the top level`。兩者精準還原後 `npm test -- test/subagent-policy.test.ts` exit 0＝24 passed，`npm run typecheck` exit 0，`npm run lint` exit 0（biome 要求的多行條件已依建議格式修正）。規則 1／2 既有案例結果與 reason 未變。

## 3. capabilities 事實觀測（RED → GREEN → REFACTOR）

**Paths / symbols:** `src/index.ts`（`handleToolResult` 的 `capabilitiesListed` 觀測改以 `normalizeSubagentInput` 取視圖；`handleToolCall` 不改）、`test/extension.test.ts`（沿用既有 `result("subagent", …)` helper 與 `it.each` 風格）。
**I/O interface:** `handleToolResult(toolName, input, isError, content)` 簽章不變；事實條件仍為 `toolName === "subagent"`、`action === "list"`、`capabilities === true`、`isError !== true`。

- [x] 3.1 RED：擴充 `test/extension.test.ts` 的 capabilities 解鎖案例，新增巢狀形狀：`result("subagent", { action: "list", options: { capabilities: true } }, "listed", false)` 後執行型派發不被 block；同一巢狀呼叫 `isError: true` 時仍 block；頂層 `{ action: "list", capabilities: true }` 仍解鎖；`{ action: "list", options: {} }` 不解鎖。執行 `npm test -- test/extension.test.ts`。預期巢狀成功案因「現行只讀頂層、維持 block」而失敗，其餘結果不變。
  - 證據：exit 1＝`Tests 1 failed | 68 passed (69)`，唯一失敗＝`a capability listing nested in options unlocks dispatch (isError=false)`；巢狀 `isError` 與無 capabilities 兩案如預期通過。
- [x] 3.2 GREEN：`src/index.ts` 的 `handleToolResult` 改用共用 helper。`npm test -- test/extension.test.ts` 全綠。
  - 證據：`npm test -- test/extension.test.ts` exit 0＝`Tests 69 passed (69)`；`npm run typecheck` exit 0。事實條件四項不變，只有讀取層改為 `normalizeSubagentInput` 的視圖；`handleToolCall` 未改。
- [x] 3.3 REFACTOR＋負向控制：確認 `isError` 與非 capabilities 的 list 不解鎖。負向控制：暫時讓該觀測回到 `input.capabilities === true`，3.1 的巢狀成功案必須再度失敗；精準還原後同一命令 exit 0。完成證據＝RED／GREEN 輸出與負向控制 assertion。
  - 證據：負向控制（`const view = input;`）exit 1＝`Tests 1 failed | 68 passed (69)`，失敗＝巢狀成功解鎖案；精準還原後 exit 0＝69 passed，`npm run typecheck` exit 0，`npm run lint` exit 0（biome 要求的單行 `h.fire(result(...))` 已依建議格式修正）。

## 4. 文件同步

**Paths / symbols:** `docs/design.md` §5.2 與 `docs/design.md` 的事件表、`README.md` 規則 1 段落、`docs/user-guide.md` 能力查詢範例。

- [x] 4.1 更新 `docs/design.md`：事件表的 `tool_result` 列與 §5.2 的三條規則說明改為「頂層與 `options` 攤平後的單一視圖」，明示 `normalizeSubagentInput` 是唯一形狀解讀點，並把事實條件改述為 `action === "list"` 且 `capabilities === true`（任一形狀）。完成證據＝`grep -n "options\|capabilitiesListed\|input.capabilities" docs/design.md`，確認不再宣稱只讀頂層 `input.capabilities`。
  - 證據：事件表列（line 151）改為「`action:"list"` 且 `capabilities:true`（頂層或 `options`）」；§5.2 新增「輸入形狀」段並指明 `normalizeSubagentInput` 是唯一形狀解讀點（line 301、306）；規則 1 事實條件（line 324）與規則 3（line 327）改為正規化視圖。`grep` 不再命中 `input.capabilities === true`。
- [x] 4.2 更新 `README.md` 規則 1 段落的觀測條件與形狀敘述（保留現有 `agent`／`workflow` 執行型定義）。完成證據＝`grep -n "capabilities" README.md` 覆核。
  - 證據：規則段開頭加形狀說明；line 124 規則 1 註明 `capabilities` 可放頂層或 `options`；規則 3 改為「呼叫參數（頂層或 `options`）」。
- [x] 4.3 更新 `docs/user-guide.md` 能力查詢範例為 `{"action":"list","options":{"capabilities":true}}`，並註明扁平形狀仍相容（供舊 caller 對照）。完成證據＝`grep -n "options" docs/user-guide.md` 覆核範例可直接照抄。
  - 證據：line 204 範例改為 `{"action":"list","options":{"capabilities":true}}`；line 207 註明扁平形狀仍相容。三個檔案 markdown lint 皆 clean。

## 5. 整合驗證與 review

**Paths / symbols:** 全 repo 驗證入口；findings 寫入 `openspec/changes/fix-subagent-options-normalization/review-notes.md`。

- [x] 5.1 完整驗證：`npm test`、`npm run typecheck`、`npm run lint`、`git diff --check` 全部 exit 0，記錄測試數；對 7 個變更檔跑 LSP diagnostics（或 `lens_diagnostics` 的 `source=lsp` / `mode=all`），記錄 clean 與否及不支援／失敗情形；`git status --short` 不得出現未預期檔案。完成證據＝命令、exit code、測試數、每檔診斷結果。
  - 證據（finding 修正後最終）：`npm test` exit 0＝**421 tests／18 files**；`npm run typecheck` exit 0；`npm run lint` exit 0（46 files，無 autofix）；`git diff --check` exit 0。7 個變更檔（含 3 份文件）的 primary LSP：`clean=7, findings=0, unsupported=0, unavailable=0, failed=0`；修正後重跑 `src/modules/subagent-policy.ts`、`test/subagent-policy.test.ts` 為 `clean=2`。`git status --short` 只有 7 個 change 檔＋`.gitignore`＋untracked `openspec/changes/fix-subagent-options-normalization/`。
- [x] 5.2 完整重讀 diff 後派發兩次唯讀 review（`review-main` 與 `review-counterpart`，不傳 `model`），提示聚焦：扁平／巢狀優先序與 D2 丟棄 `undefined` 的健全性、fail-open 邊界、規則 3 行為收緊是否為可接受的 MUST 恢復、測試是否釘住兩種形狀與遮蔽案。findings 附 `file:line`、影響與裁決寫入 `review-notes.md`；採納的修正只由單一 writer 執行，修後重跑相關測試與診斷。
  - 證據：parallel workflow mission `22f6dbcf-ce76-4e31-96d1-ab53a8e6c1d1`；`review-main`（`ad154543-54bb-4967-948e-ca619bc5d5cb`）與 `review-counterpart`（`e9641d08-cbee-4ef5-831a-93f0b060dc9f`）均 completed、均唯讀。findings 3 項：1 項採納（P2：`handleToolResult` 未 guard 而 helper 列舉面變寬，且 design 宣稱「不拋錯」）已 RED→GREEN 修正（helper 改 total；RED＝`Error: hostile getter` 1 failed／25；GREEN＝25 passed）；2 項不採納（`.gitignore` out-of-scope、view 保留 `options` 鍵屬已凍結設計的刻意選擇）。完整裁決與 blob SHA 記於 `review-notes.md`。
- [x] 5.3 最終閘門：`node ~/.pi/agent/skills/openspec-superpowers-workflow/scripts/validate-openspec-workflow.cjs openspec/changes/fix-subagent-options-normalization`、`openspec validate fix-subagent-options-normalization --strict --no-interactive`、`git diff --stat` 與 `git status --short`；確認 artifact 與殘餘變更符合預期，且 review 的 open findings 為零。完成證據＝各命令 exit code 與 diff stat。
  - 證據：pre-check `VALID` exit 0；`openspec validate … --strict --no-interactive`＝`is valid` exit 0。`git diff --stat`＝8 files changed, 180 insertions(+), 25 deletions(-)（其中 `.gitignore` 為 out-of-scope hygiene）；`git status --short` 如 5.1。review 的 open findings 為零（1 項已修並複驗，2 項有具名理由不採納）。

## Workflow follow-up

- 通過 Phase 5 與使用者核准後，才依專案 Git 規則建立 checkpoint commit（僅限本 change 的 7 個檔案；`.gitignore` 與 scope-ledger 檔另行處理）。
- Phase 6 reconciliation 後歸檔；確認 canonical `subagent-dispatch-policy` 由 delta 正確建立且不含 delta operation headers。
