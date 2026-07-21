# 动态拉取 CodeBuddy 模型列表

## 背景

当前 Workbuddian 的模型选择下拉菜单使用硬编码列表 `src/shared/cliOptions.ts` 中的 `MODEL_OPTIONS`。CodeBuddy CLI 的 `--model` 选项实际支持的模型会随版本更新，硬编码列表需要手动同步，容易滞后。

## 目标

- 插件启动时从 CodeBuddy CLI `--help` 输出中动态解析可用模型列表。
- CLI 不可用或解析失败时，回退到现有硬编码列表，保证功能可用。
- 不阻塞 Obsidian 启动，拉取在后台完成；完成后刷新已打开的聊天面板。

## 非目标

- 不新增 CLI 子命令或 API 调用（CLI 没有 `--list-models`）。
- 不持久化模型列表到设置文件。
- 不在模型列表拉取失败时弹窗打扰用户。

## 方案

采用**启动时后台异步拉取 + 硬编码兜底**方案。

### 新增模块：`src/providers/codebuddy/models.ts`

职责单一：执行 `codebuddy --help`，解析 `--model` 描述行，返回模型列表。

```ts
export interface ModelListResult {
  models: string[];   // 不含 auto
  source: 'cli' | 'fallback';
}

/** 从 codebuddy --help 文本中提取模型 ID 列表 */
export function parseModelList(helpText: string): string[];

/** 执行 CLI --help 并解析模型列表，失败则返回硬编码兜底 */
export async function fetchModels(scriptPath: string): Promise<ModelListResult>;
```

解析目标行示例：

```
--model <model>                                  Model for the current session. Please provide the model ID. Currently supported: (auto, hy3, glm-5.2, glm-5.1, glm-5v-turbo, minimax-m3, kimi-k2.7, kimi-k2.6, deepseek-v4-flash, deepseek-v4-pro)
```

正则提取括号内逗号分隔项，过滤 `auto`，得到模型 ID 数组。

### `CodebuddyProvider` 改动

- 新增 `private availableModels: string[] = FALLBACK_MODEL_OPTIONS`。
- 新增 `setAvailableModels(models: string[]): void`。
- 新增 `getAvailableModels(): string[]`。
- 把 `src/shared/cliOptions.ts` 中的 `MODEL_OPTIONS` 改名为 `FALLBACK_MODEL_OPTIONS` 并保留，用于初始化与兜底。

### `main.ts` 改动

在 `onload()` 创建 `CodebuddyProvider` 并 `applySettingsToApi()` 之后，启动后台任务：

```ts
this.api = new CodebuddyProvider();
this.applySettingsToApi();

// 后台刷新可用模型列表，不阻塞启动
void this.refreshAvailableModels();
```

新增私有方法：

```ts
private async refreshAvailableModels(): Promise<void> {
  try {
    const result = await fetchModels(this.api.getScriptPath());
    if (result.source === 'cli') {
      this.api.setAvailableModels(result.models);
      this.refreshOpenViews();
    }
  } catch (e) {
    bbError('[WB] 拉取模型列表失败:', e);
  }
}
```

### `src/features/chat/input.ts` 改动

`openModelMenu` 不再直接读取 `MODEL_OPTIONS`，而是读取 `view.api.getAvailableModels()`：

```ts
const models = view.api.getAvailableModels();
for (const id of ['auto', ...models]) { ... }
```

### 错误降级

| 场景 | 行为 |
|------|------|
| CLI 返回非 0 | 保留 `FALLBACK_MODEL_OPTIONS`，写 `bbError` |
| `--help` 输出里没有 `--model` 行 | 同上 |
| 括号内列表为空 | 同上 |
| 超时 | 同上 |
| 路径未配置/CLI 不存在 | 同上 |

### 测试

新增 `tests/models.test.ts`：

1. `parseModelList` 正确解析真实 `--help` 片段。
2. 解析失败/无匹配行时返回空数组。
3. `fetchModels` 在 CLI 成功时返回 `source: 'cli'`。
4. `fetchModels` 在 CLI 失败时返回 `source: 'fallback'` 与硬编码列表。

复用 `tests/api.test.ts` 中 `jest.mock('child_process')` 的模式。

### 依赖与影响

- 不新增 npm 依赖。
- 不影响 `settings.model` 类型（仍为 `string`）。
- 不新增 i18n 文案。
- 设置页模型下拉菜单已移除，无需改动设置页。

## 风险与缓解

- **CLI `--help` 格式变化导致解析失效**：兜底列表保证菜单仍可打开；日志记录便于排查。
- **启动时后台 spawn 失败**：静默失败，不影响聊天功能。
- **模型列表与 CLI 实际支持不一致**：动态拉取后理论上与 CLI 当前版本一致；若解析失败则使用硬编码兜底。

## 验收标准

- [ ] `npm run build` 通过。
- [ ] `npm test` 通过，新增测试覆盖 `parseModelList` 与 `fetchModels`。
- [ ] 插件启动后，已打开聊天面板的模型下拉菜单最终显示 CLI 解析出的模型列表。
- [ ] 断开 CLI 路径或模拟 `--help` 失败时，菜单仍显示硬编码兜底列表。
