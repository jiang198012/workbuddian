#!/usr/bin/env python3
"""临时把 demo-vault 设为 Obsidian 唯一 open 的 vault(测试用),支持恢复。

用法:
  python3 obsidian-vault-pin.py pin [vault_path]    # 备份 obsidian.json,仅 demo-vault open:true
  python3 obsidian-vault-pin.py restore             # 从备份恢复原状

绝不修改正式 vault 内容,只临时改 Obsidian 的 vault 选择状态(启动后恢复)。
"""
import json
import os
import shutil
import sys

OBSIDIAN_JSON = os.path.expanduser('~/Library/Application Support/obsidian/obsidian.json')
BACKUP = OBSIDIAN_JSON + '.wb-backup'


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'pin':
        vault_path = os.path.realpath(sys.argv[2]) if len(sys.argv) > 2 else os.path.realpath(os.getcwd())
        if not os.path.exists(OBSIDIAN_JSON):
            print('✗ 找不到', OBSIDIAN_JSON)
            return 1
        shutil.copy2(OBSIDIAN_JSON, BACKUP)
        with open(OBSIDIAN_JSON, 'r', encoding='utf-8') as f:
            data = json.load(f)
        pinned = False
        for v in data.get('vaults', {}).values():
            is_demo = os.path.realpath(v.get('path', '')) == vault_path
            v['open'] = True if is_demo else False
            if is_demo:
                pinned = True
        if not pinned:
            print(f'✗ 未找到 vault: {vault_path}')
            os.replace(BACKUP, OBSIDIAN_JSON)  # 还原
            return 1
        with open(OBSIDIAN_JSON, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False)
        print(f'✔ 已临时设 {vault_path} 为唯一 open(备份于 {BACKUP})')
    elif cmd == 'restore':
        if os.path.exists(BACKUP):
            os.replace(BACKUP, OBSIDIAN_JSON)
            print('✔ 已恢复 obsidian.json 原状')
        else:
            print('无备份,跳过')
    else:
        print('用法: pin [vault_path] | restore')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
