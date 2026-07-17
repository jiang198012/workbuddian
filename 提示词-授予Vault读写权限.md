# LLM Wiki 授权配置提示词

将此提示词发送给新电脑的 WorkBuddy/CodeBuddy，它会引导你完成一次性授权。

---

## 场景识别（重要）

请根据你的使用场景选择对应路径：

**场景 A：通过 Obsidian 的 Workbuddian 插件调用 CodeBuddy（最常见）**
→ 配置文件路径：`~/.codebuddy/settings.json`
→ 这是通过 Obsidian Workbuddian 插件调用 CodeBuddy 的方式，和直接运行 CodeBuddy CLI 是同一个配置文件

**场景 B：直接使用 CodeBuddy CLI（命令行）**
→ 配置文件路径：`~/.codebuddy/settings.json`

**场景 C：使用 WorkBuddy 桌面版**
→ 配置文件路径：`~/.workbuddy/settings.json`

---

## 任务

我现在在 Obsidian 的 Workbuddian 调用 CodeBuddy，现在没有写入权限，需要你帮我完成授权。

请按以下步骤操作：

### 1. 确认平台和路径

先问我两个问题：
1. 使用的是 **WorkBuddy 桌面版** 还是 **CodeBuddy CLI（包括通过 Workbuddian 插件调用）**？
2. 你的 Obsidian Vault 绝对路径是什么？（如 E:/MyVault）

### 2. 确定配置文件路径

根据我的回答选择正确的配置文件：
- **CodeBuddy CLI / Workbuddian 插件** → `~/.codebuddy/settings.json`
- **WorkBuddy 桌面版** → `~/.workbuddy/settings.json`

> ⚠️ **关键区别**：Workbuddian 插件启动的是 CodeBuddy CLI，所以必须改 `~/.codebuddy/settings.json`，不是 `~/.workbuddy/settings.json`。这两个文件是不同的，改错文件会导致权限不生效。

### 3. 读取现有配置

尝试 Read 该配置文件。如果文件不存在，进入步骤 4 创建。

### 4. 写入配置

**写入要求（必须严格遵守）：**
- 用 **无 BOM 的 UTF-8 编码** 写入
- JSON 格式必须正确，键名和值之间不要有多余空格或换行
- 如果文件已存在，保留原有字段，只补充缺失的字段

**配置内容：**

```json
{
  "trustedDirectories": [
    "C:/Users/user",
    "<VAULT_PATH>"
  ],
  "permissions": {
    "allow": ["Write", "Bash", "PowerShell", "Read", "Edit", "Glob", "Grep"]
  }
}
```

其中 `<VAULT_PATH>` 替换为实际的 Vault 路径（Windows 路径用正斜杠 `/`，如 `E:/MyVault`）。

**对于 WorkBuddy 桌面版的特殊情况：**
如果修改的是 `~/.workbuddy/settings.json`，`permissions` 可能需要放在 `sandbox` 字段下：

```json
{
  "sandbox": {
    "permissions": {
      "allow": ["Write", "Bash", "PowerShell", "Read", "Edit", "Glob", "Grep"]
    }
  },
  "trustedDirectories": [
    "<VAULT_PATH>"
  ]
}
```

### 5. 验证写入

写入后必须验证：
1. 用 `cat` 或 `Read` 读取文件，确认内容正确
2. 用 `od -c` 检查文件开头没有 `357 273 277`（UTF-8 BOM 头），开头应该是 `{` 字符
3. 如果发现 BOM 头，用 PowerShell 或 Python 重新写入无 BOM 的版本

### 6. 重启生效

配置写入正确后，告诉我：

> ✅ 授权配置完成
>
> 配置文件：`<config_path>`
> 已授权目录：`<vault_path>`
>
> **下一步：完全退出 WorkBuddy/CodeBuddy（系统托盘右键退出，不是只关面板），然后重新打开，权限才会生效。**
>
> 重启后请测试一下 Bash 和 Write 是否通过，然后告诉我结果。

### 7. 验证权限

重启后，主动测试权限是否生效：
- 测试 Bash：执行 `mkdir` 或 `ls`
- 测试 Write：创建一个小测试文件
- 如果仍然被拒，检查日志中的 `permMode` 是否为 `default`，以及 `SandboxExecPolicy` 是否显示 `allow=0`

### 8. 异常处理

- **如果写入失败**（权限不足/沙箱限制），告诉用户手动执行命令，给出完整的 `mkdir -p` + `cat >` 命令或 PowerShell 命令。
- **如果 Vault 路径不存在**（ls 失败），提示用户确认路径是否正确。
- **如果重启后仍然被拒**，排查：
  1. 是否改对了文件（Workbuddian 必须用 `~/.codebuddy/settings.json`）
  2. 文件是否有 BOM 头
  3. JSON 格式是否正确（`permissions` 必须是对象，不是数组）
  4. 是否完全重启了应用（不是只关面板）

---

## 已知陷阱（来自实际踩坑经验）

1. **改错文件**：WorkBuddy 桌面版和 CodeBuddy CLI 的配置文件在不同目录（`.workbuddy` vs `.codebuddy`），Workbuddian 启动的是 CodeBuddy，必须改 `.codebuddy` 下的文件。
2. **BOM 头问题**：Windows PowerShell 的 `Set-Content` 可能写入带 BOM 的文件，导致 CodeBuddy JSON 解析静默失败，配置被忽略。
3. **重启不彻底**：只关闭对话面板不会重新加载配置，必须从系统托盘完全退出应用。
4. **Workbuddian 的 CLI 参数**：Workbuddian 启动 CodeBuddy 时只传了 `--print` 和 `--session-id`，没有 `--permission-mode`，所以 `permMode` 始终是 `default`，必须依赖配置文件正确生效。

---

## 授权完成后

权限生效后，将 LLM Wiki 知识库的 skill prompt 发送给我，然后发送 `/init` 开始初始化知识库。
