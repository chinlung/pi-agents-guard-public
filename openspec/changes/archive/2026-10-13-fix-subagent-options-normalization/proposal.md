## Why

pi-subagents 0.77.0 把 model-facing `subagent` 工具的參數改為「少數頂層欄位 + 其餘收進單一 `options` 物件」後，agents-guard 仍只讀頂層欄位，造成兩個既有政策靜默失效：派發前 capabilities 檢查永遠無法被解鎖（合法派發全數誤擋），以及 external CLI runner 的 native-only 選項檢查看不到 `options` 內容（違規派發漏擋）。兩者都是輸入形狀綁定過時，不是政策本身要改。

## What Changes

- 在 subagent 政策入口引入單一輸入正規化：把物件型 `input.options` 攤平到頂層視圖，優先序對齊上游 `flattenSubagentToolOptions` 的 `{ ...topLevel, ...options }`；三條規則與 capabilities 觀測都只讀正規化後的視圖。
- 修正規則 1 的事實來源：`{action:"list", options:{capabilities:true}}` 的成功回應 SHALL 能設定 `capabilitiesListed`；現行「list 過卻仍被擋」的誤擋消失。
- 修正規則 3：`context`／`acceptance`／`outputSchema`／`toolBudget`／`fast`／`skill`／`mission` 出現在 `options` 時，對 external CLI agent 同樣列為違規欄位。
- **BREAKING（行為）：** external CLI agent 帶 native-only 選項的呼叫，從目前的漏放改為 block；這是恢復既定政策，不是新增政策。
- 保留舊扁平形狀相容：RPC／slash／workflow caller 與 0.77 之前的 session 仍以頂層欄位判定，結果不變。
- 同步 `docs/design.md` §5.2 與 `README.md` 對 subagent 輸入形狀與事實來源的描述。

### Non-goals

- 不改三條規則的語意、門檻或 pattern 預設，不改 hard-deny／writer／completion／git-evidence。
- 不新增 pi-subagents 依賴、不鎖定其版本、不要求宿主改版；不實作通用 JSON schema 正規化框架。
- 不改 package／lockfile／CI，不新增 production dependency，不改公開 `Runtime`／`RuntimeDeps`／`createRuntime` 介面。

## Capabilities

### New Capabilities

- `subagent-dispatch-policy`：subagent 派發前的機械式政策契約，涵蓋 capabilities 前置事實、輸入形狀綁定、高風險不降級與 external runner native-only 選項四項要求。

### Modified Capabilities

無。Canonical `completion-recheck` 與 `writer-lock-safety` 不變；本次不新增或修改其他 capability。

## Impact

| 範圍 | 檔案與相容性 |
|---|---|
| 政策判定 | `src/modules/subagent-policy.ts` 新增輸入正規化並供規則 1／2／3 共用；`decideSubagentCall` 保持純函式、零 I/O。 |
| Runtime 事實 | `src/index.ts` 的 `handleToolResult` 以正規化視圖觀察 `capabilitiesListed`；`handleToolCall` 以正規化視圖呼叫政策。公開 Runtime API 不變。 |
| 測試 | `test/subagent-policy.test.ts`（兩種形狀的規則 1／3）、`test/extension.test.ts`（wiring：巢狀 list 解鎖、失敗不解鎖）。 |
| 文件 | `docs/design.md` §5.2 與 `README.md` 的輸入形狀說明；歷史 plans／archives 不改。 |
| 依賴 | 無新增；不變更 `package.json`／`package-lock.json`／CI。 |

## Contract Boundaries

| 契約面 | 本 change 的影響 |
|---|---|
| Public API | 無變化；`decideSubagentCall` 與 Runtime 方法簽章保留，新增的只是模組內部 helper。 |
| Data contract | 無持久資料；不新增設定鍵或 state schema。 |
| Schema | 無 schema／migration。 |
| Migration | 無。 |
| Backward compatibility | 有：同時接受扁平與巢狀 `options` 形狀，舊形狀判定結果不變。 |
| Security / permissions | 有：external runner 的 native-only 選項檢查由漏放恢復為 block，屬恢復既有防線的行為修正。 |
| Concurrency / consistency | 無變化；政策仍為同步純判定。 |
| Cross-module behavior | 有：`src/index.ts` 的事實觀測與 `src/modules/subagent-policy.ts` 的判定必須共用同一套正規化，避免兩處形狀解讀分歧。 |

## Validation Scope

RED→GREEN 證據、實際命令與平台界線記於 `tasks.md`／`review-notes.md`。純函式測試與 extension wiring 測試各自提供不同層級證據，不互相冒充；不宣稱已安裝或發布。
