import { buildInstructionBlock } from '../../shared/instruction';

export function assembleContextText(
    text: string,
    vaultPath: string | undefined,
    injectVaultContext: boolean,
    currentNoteLink: string,
    referenceBlock: string,
    customInstruction: string = ''
): string {
    let contextText = (vaultPath && injectVaultContext)
        ? `当前 Obsidian Vault 路径: ${vaultPath}
工作目录即 vault 根目录，请基于 vault 中的文件回答问题。

---

${text}`
        : text;
    if (currentNoteLink) {
        contextText = `${contextText}

---

${currentNoteLink}`;
    }
    if (referenceBlock) {
        contextText = `${contextText}

---

${referenceBlock}`;
    }
    const instructionBlock = buildInstructionBlock(customInstruction);
    if (instructionBlock) {
        contextText = `${instructionBlock}

---

${contextText}`;
    }
    return contextText;
}
