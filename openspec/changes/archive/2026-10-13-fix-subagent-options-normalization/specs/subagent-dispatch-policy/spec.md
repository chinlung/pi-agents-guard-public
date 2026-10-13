# Spec Delta

## Purpose

定義 agents-guard 對 `subagent` 工具呼叫執行派發前政策所需的可觀察行為：capabilities 前置事實、輸入形狀綁定、高風險任務不降級，以及 external CLI runner 不吃 native-only 選項。

## ADDED Requirements

### Requirement: Dispatch prerequisite observation

系統 SHALL 只在同一 session 內觀察到一次成功的 capabilities 列表回應後，才允許執行型 subagent 派發；觀測來源 SHALL 是模型實際傳入的參數（含 `options` 巢狀形狀）。帶 `action` 的管理／控制呼叫 MUST NOT 受此規則約束，parent-governed child session MUST 停用此規則。

#### Scenario: Nested capability listing unlocks dispatch

- **WHEN** 一個 `subagent` 的 `tool_result` 顯示 `action:"list"`、`options.capabilities:true` 且非 error
- **THEN** 該事實被記錄，之前的執行型派發維持 block，之後的執行型派發通過

#### Scenario: Failed or non-capability listing does not unlock

- **WHEN** 同一呼叫回報 error，或 `options.capabilities` 不是 `true`
- **THEN** 執行型派發仍被 block

#### Scenario: Management call is exempt

- **WHEN** 尚未完成 capabilities 列表，但呼叫帶 `action`（例如 `status`／`list`）
- **THEN** 不因本規則被 block

### Requirement: Input shape binding

政策判定 SHALL 同時支援 model-facing 的巢狀 `options` 形狀與扁平形狀，並以 `{ ...topLevel, ...options }` 的優先序還原單一視圖。系統 MUST NOT 因形狀差異漏判或誤判任一規則，且 MUST NOT 讓非物件 `options` 造成判定失敗。

#### Scenario: Native-only option nested in options

- **WHEN** external CLI agent 的呼叫把 native-only 選項放在 `options` 內
- **THEN** 得到與放在頂層相同的 block 判定，reason 列出該違規欄位

#### Scenario: Flat shape remains supported

- **WHEN** 呼叫以頂層扁平欄位提供同一選項或 capabilities
- **THEN** 判定與巢狀形狀一致，舊 caller 行為不變

#### Scenario: Non-object options

- **WHEN** `options` 是 `null`、陣列或非物件
- **THEN** 以頂層欄位判定，不拋出錯誤

### Requirement: High-risk task is not silently downgraded

若 `agent` 名稱或 `task` 命中 review／audit／security／threat intent pattern，且呼叫明確指定了命中弱模型 pattern 的 `model`，系統 SHALL block 該派發。未指定 `model` 時 MUST NOT 由本規則判定。

#### Scenario: Review intent with weak model

- **WHEN** review 意圖的 agent 或 task 搭配明確指定的弱模型
- **THEN** 派發被 block，reason 說明高風險任務不得降級

#### Scenario: No explicit model

- **WHEN** review 意圖的 agent 或 task 未指定 `model`
- **THEN** 本規則不阻擋（沿用 agent 預設不算降級）

### Requirement: External runner rejects native-only options

若 `agent` 屬 external CLI runner 清單，且呼叫在頂層或 `options` 提供任一 native-only 選項，系統 SHALL block 並列出所有違規欄位；未提供任何 native-only 選項時 MUST NOT 由本規則阻擋。

#### Scenario: External agent with native-only options

- **WHEN** external CLI agent 的呼叫帶有 `model`、`context`、`acceptance`、`outputSchema`、`toolBudget`、`fast`、`skill` 或 `mission` 任一欄位
- **THEN** 派發被 block，reason 逐項列出違規欄位

#### Scenario: External agent without native-only options

- **WHEN** external CLI agent 的呼叫不含任何 native-only 欄位
- **THEN** 本規則不阻擋；是否通過仍由其他規則決定
