# 任务 C + 图片升级实现计划

> inline 执行。Spec: `docs/superpowers/specs/2026-08-03-acp-word-diff-bash-thoughtlevel-image-design.md`

**Goal:** 词级 diff 高亮、Bash 终端块、thought_level 设置、原生图片内容块；文生图入档搁置。

## Global Constraints
- acp/* 零 obsidian import；i18n 中英；settings 版本保持 11（本批未发布）。
- 每 Task jest 绿；最后全量 + build + smoke 11/11 不回退。
- conventional commits。

### Task 1: wordDiff 纯模块 + 渲染接入
**Files:** Create `src/shared/wordDiff.ts`；Modify `src/features/chat/input.ts`（tool diff 循环 + renderApprovalDetail edit 分支）；Test `tests/wordDiff.test.ts`

- [ ] 测试先行 `tests/wordDiff.test.ts`：

```ts
import { splitInlineDiff } from '../src/shared/wordDiff';

describe('splitInlineDiff', () => {
    it('trims common prefix and suffix, marks middle as changed', () => {
        const r = splitInlineDiff('const a = 1;', 'const a = 2;');
        expect(r.oldSegs).toEqual([{ text: 'const a = ', changed: false }, { text: '1', changed: true }, { text: ';', changed: false }]);
        expect(r.newSegs).toEqual([{ text: 'const a = ', changed: false }, { text: '2', changed: true }, { text: ';', changed: false }]);
    });
    it('identical lines → single unchanged segment', () => {
        expect(splitInlineDiff('abc', 'abc').oldSegs).toEqual([{ text: 'abc', changed: false }]);
    });
    it('fully different → whole changed', () => {
        const r = splitInlineDiff('foo', 'bar');
        expect(r.oldSegs).toEqual([{ text: 'foo', changed: true }]);
        expect(r.newSegs).toEqual([{ text: 'bar', changed: true }]);
    });
    it('handles empty sides', () => {
        expect(splitInlineDiff('', 'x').newSegs).toEqual([{ text: 'x', changed: true }]);
        expect(splitInlineDiff('x', '').oldSegs).toEqual([{ text: 'x', changed: true }]);
        expect(splitInlineDiff('', '').oldSegs).toEqual([{ text: '', changed: false }]);
    });
});
```

- [ ] 实现 `src/shared/wordDiff.ts`：

```ts
export interface InlineSegment { text: string; changed: boolean }

/** 行内最小 diff：裁公共前缀与后缀，中段即变更（字符级，YAGNI） */
export function splitInlineDiff(oldLine: string, newLine: string): { oldSegs: InlineSegment[]; newSegs: InlineSegment[] } {
    let pre = 0;
    const maxPre = Math.min(oldLine.length, newLine.length);
    while (pre < maxPre && oldLine[pre] === newLine[pre]) pre++;
    let suf = 0;
    while (suf < Math.min(oldLine.length, newLine.length) - pre
        && oldLine[oldLine.length - 1 - suf] === newLine[newLine.length - 1 - suf]) suf++;
    const build = (line: string): InlineSegment[] => {
        const segs: InlineSegment[] = [];
        if (pre > 0) segs.push({ text: line.slice(0, pre), changed: false });
        const mid = line.slice(pre, line.length - suf);
        if (mid) segs.push({ text: mid, changed: true });
        if (suf > 0) segs.push({ text: line.slice(line.length - suf), changed: false });
        if (!segs.length) segs.push({ text: '', changed: false });
        return segs;
    };
    return { oldSegs: build(oldLine), newSegs: build(newLine) };
}
```

- [ ] input.ts 接入：diff 渲染循环里，remove 行与紧随 add 行配对时调用 splitInlineDiff，changed 段包 `<span class="workbuddian-diff-hl">`；配对规则：lineDiff 输出序列中 `remove` 后紧跟 `add` 视为一对（实现时读 lineDiff 返回结构校准）。批准卡 edit 分支同法。styles.css 加 `.workbuddian-diff-hl`（add 行内绿加深/remove 行内红加深）。
- [ ] `npx jest tests/wordDiff.test.ts` 绿 + build 过。Commit: `feat(chat): 词级行内 diff 高亮`

### Task 2: Bash 终端块
**Files:** Modify `index.ts`（StreamChunk.toolOutput）、`acp/events.ts`（mapToolCallUpdate）、`acp/session.ts`（透传 update）、`input.ts`（渲染）、`styles.css`；Test `tests/acpEvents.test.ts`/`tests/acpSession.test.ts`

- [ ] 测试先行：
  - events：`mapToolCallUpdate({status:'completed', rawOutput:{type:'text',text:'Command: ls…'}}, snapshot)` → chunk 带 `toolOutput`；rawOutput 缺失 → 无该字段。
  - session：completed update 带 rawOutput → onChunk 的 chunk.toolOutput 等于原文。
- [ ] 实现：
  - StreamChunk 加 `toolOutput?: string`（注释：completed 工具的原始输出，目前用于 Bash 终端块）。
  - mapToolCallUpdate 签名改为 `(update, snapshot)`，completed 分支：`const ro = update.rawOutput as {type?:unknown;text?:unknown}|undefined; const toolOutput = ro?.type==='text' && typeof ro.text==='string' ? ro.text : undefined;` 带上。
  - input.ts completed 分支：`toolName` 为 Bash/Shell 且 `chunk.toolOutput` → 行下渲染终端块：`list.createDiv({cls:'workbuddian-bash-block'})` 内 `pre` 全文本；沿用 diff 块的折叠交互（默认折叠，header「输出」展开）。与 diff 互斥（Bash 无 parseFileChange）。
  - styles.css：`.workbuddian-bash-block pre { font-family: var(--font-monospace); font-size:12px; white-space: pre-wrap; margin: 4px 0; }` 等。
- [ ] jest 绿 + build。Commit: `feat: Bash 终端输出块（completed rawOutput 透传与渲染）`

### Task 3: thought_level 设置
**Files:** Modify `types/index.ts`、`acp/session.ts`（applyConfig）、`acp/events.ts`（mapConfigUpdate）、`providers/codebuddy/index.ts`（setThoughtLevel）、`main.ts`、`features/settings/tab.ts`、`features/chat/input.ts`（onConfigUpdate 回写）、`i18n`；Test `types.test.ts`/`acpEvents.test.ts`/`providerCallbacks.test.ts`

- [ ] 测试先行：
  - types：默认 `'enabled'`、非 string 回落。
  - events：mapConfigUpdate 对 `config_option_update` 含 `{id:'thought_level', currentValue:'high'}` → `{thoughtLevel:'high'}`。
  - provider：`setThoughtLevel('high')` 后 sendMessage 建会话 → fake request 收到 `session/set_config_option {configId:'thought_level', value:'high'}`。
- [ ] 实现：
  - types：`thoughtLevel: string` 默认 `'enabled'` + migrate。
  - SessionConfig 加 `thoughtLevel?: string`；applyConfig 追加 `set_config_option {configId:'thought_level', value: this.config.thoughtLevel}`（非空时，try/catch bbLog）。
  - mapConfigUpdate：configOptions 里 `id==='thought_level'` → out.thoughtLevel。
  - provider：`setThoughtLevel(level: string)` → config.thoughtLevel + 对已加载会话 applyRemoteConfig（复用）。
  - TurnHandlers.onConfigUpdate cfg 类型加 `thoughtLevel?: string`；input.ts applyToolbarConfig：`cfg.thoughtLevel && !== settings.thoughtLevel` → 写 settings + saveSettingsCallback（无工具栏可视件）。
  - main.ts applySettingsToApi 加 `this.api.setThoughtLevel(this.settings.thoughtLevel)`。
  - tab.ts 连接组加下拉（七档：enabled/minimal/low/medium/high/xhigh/max）。
  - i18n：`settings.thoughtLevel`（思考力度/Thinking effort）、`settings.thoughtLevelDesc`（对应 CLI thought_level；/effort 命令改动会同步回这里）。
- [ ] jest 绿 + build。Commit: `feat: thought_level 设置（按会话应用 + 回流同步）`

### Task 4: 原生图片内容块
**Files:** Modify `acp/session.ts`（prompt images 参）、`providers/codebuddy/index.ts`（sendMessage 第 6 参）、`features/chat/input.ts`（sendText 图片拆分与读取）；Test `acpSession.test.ts`/`api.test.ts`

- [ ] 测试先行：
  - session：`prompt(text, handlers, [{data:'YmFzZTY0', mimeType:'image/png'}])` → session/prompt params.prompt = `[{type:'image', data:'YmFzZTY0', mimeType:'image/png'}, {type:'text', text}]`；不传 images → 仅 text 块。
  - provider：sendMessage 第 6 参 images → 到达 fake request 的 session/prompt params。
- [ ] 实现：
  - session.prompt 签名 `prompt(text: string, handlers: TurnHandlers, images?: Array<{ data: string; mimeType: string }>)`；blocks 构造图片在前。
  - provider sendMessage 加 `images?: Array<{ data: string; mimeType: string }>` 透传。
  - input.ts sendText（slash 除外的分支）：
    ```ts
    const imagePaths = view.attachments.filter(isImagePath);
    const filePaths = view.attachments.filter((p) => !isImagePath(p));
    const images: Array<{ data: string; mimeType: string }> = [];
    const imageFallbacks: string[] = []; // 读取失败/ vault 外 → 退回路径注入
    for (const p of imagePaths) {
        if (view.vaultPath && p.startsWith(view.vaultPath + '/')) {
            try {
                const rel = p.slice(view.vaultPath.length + 1);
                const buf = await view.app.vault.adapter.readBinary(rel);
                images.push({ data: Buffer.from(buf).toString('base64'), mimeType: mimeForExt(p) ?? 'image/png' });
                continue;
            } catch (e) { bbLog('[WB] 图片读取失败，退回路径注入:', p, e); }
        }
        imageFallbacks.push(p);
    }
    const attachmentBlock = buildAttachmentBlock([...filePaths, ...imageFallbacks]);
    ```
    mimeForExt 的现有签名以 `shared/imageStore.ts` 为准（按 ext 取 mime；若无该工具函数则按扩展名小表实现）。`Buffer` 在 Obsidian 桌面端可用（electron node 集成）。随后 `api.sendMessage(..., images)`。
  - isImagePath 已从 imageStore import（input.ts:13）。
- [ ] jest 绿 + build。Commit: `feat: 粘贴/附件图片走 ACP 原生图片块`

### Task 5: 验收 + 手测 C 组
- [ ] 全量 jest 绿 + build 过 + `node scripts/acp-smoke.mjs` 仍 11/11。
- [ ] `docs/manual-test-2026-08-03-acp-v2.md` 加 C 组：
  - C7 词级 diff：Edit 改几个字 → diff 行内变更段高亮。
  - C8 Bash 终端块：让 AI 跑 `echo hello` → 完成出行下方「输出」折叠块含 Exit Code。
  - C9 thought_level：设置页切 high → 发消息 →「查看日志」可见 set_config_option thought_level；用 `/effort low`（斜杠透传）→ 设置值回流更新。
  - C10 图片块：粘贴截图发问「图里是什么」→ 全程无 Read 工具调用、回答正确描述图片。
  - C11 文生图（能力展示）：发「生成一张猫的图片存到 vault」→ 文件出现、工具行经批准卡。
- [ ] Commit: `docs: 手测清单 C 组`

## Self-Review
- Spec §2.1-2.5 逐项落 Task 1-4；§3 测试策略逐条有落点；§4 非目标未安排。
- 签名一致：`splitInlineDiff`、`toolOutput`、`setThoughtLevel(level: string)`、`prompt(text, handlers, images?)`、sendMessage 第 6 参 `images?: Array<{data:string; mimeType:string}>` 全文一致。
- Task 4 的 mimeForExt/readBinary 以执行时读到的真实签名/行为校准（计划已注明）。
