<div align="center">

<img src="https://raw.githubusercontent.com/ClawBackup-AI/ClawBackup/master/docs/images/logo.png" alt="ClawBackup Logo" width="200" height="200">

# ClawBackup

**OpenClaw 增强备份插件**

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Plugin-green.svg)](https://github.com/openclaw)

[English](README.md) | [中文](README_CN.md)

</div>

---

ClawBackup 是一个 OpenClaw 插件，为 OpenClaw 提供增强的备份和恢复功能。支持本地备份、加密备份、S3/OSS 云存储同步等功能。

## ✨ 功能特性

- **本地备份** - 备份 OpenClaw 配置、工作区和会话数据
- **加密备份** - 使用 AES-256-CBC 加密保护敏感数据
- **云存储同步** - 支持 S3 兼容存储（AWS S3、阿里云 OSS 等）
- **流式传输** - 内存友好的大文件流式上传/下载
- **备份验证** - 验证备份完整性
- **快照回滚** - 恢复前自动创建快照，支持回滚

## 🚀 安装

从源码安装：

```bash
# 克隆仓库
git clone https://github.com/ClawBackup-AI/ClawBackup.git
cd ClawBackup

# 安装依赖
npm install

# 构建
npm run build

# 安装为 OpenClaw 插件
openclaw plugins install .
```

## 📖 快速开始

```bash
# 初始化配置
openclaw clawbackup init

# 创建备份
openclaw clawbackup create

# 列出备份
openclaw clawbackup list

# 恢复备份
openclaw clawbackup restore <backup_id>

# 查看状态
openclaw clawbackup status
```

---

## 🤖 与 Agent 配合使用

ClawBackup 注册了以下工具，可以直接通过与 OpenClaw Agent 对话来使用：

### 可用工具

| 工具名称 | 描述 |
|----------|------|
| `backup_create` | 创建备份 |
| `backup_list` | 列出所有备份 |
| `backup_restore` | 恢复备份 |
| `backup_sync` | 同步备份到远端存储 |
| `backup_delete` | 删除备份 |
| `backup_verify` | 验证备份完整性 |
| `backup_status` | 获取备份状态概览 |

### 使用示例

直接与 Agent 对话，它会自动调用相应的工具：

**创建备份：**
```
用户: 帮我创建一个备份
Agent: [调用 backup_create 工具] 备份已创建，ID: backup_20240320_abc123

用户: 创建一个加密备份，密码是 mypassword
Agent: [调用 backup_create 工具，password: "mypassword"] 加密备份已创建

用户: 只备份配置文件
Agent: [调用 backup_create 工具] 配置备份已创建
```

**列出备份：**
```
用户: 列出所有备份
Agent: [调用 backup_list 工具] 找到 5 个备份...

用户: 只显示最近 10 个备份
Agent: [调用 backup_list 工具，limit: 10] ...

用户: 只显示 ClawBackup 备份
Agent: [调用 backup_list 工具，type: "clawbackup"] ...
```

**恢复备份：**
```
用户: 恢复备份 backup_20240320_abc123
Agent: [调用 backup_restore 工具] 已恢复到原位置

用户: 恢复备份到 ./restore 目录
Agent: [调用 backup_restore 工具，target: "./restore"] 已恢复到 ./restore

用户: 从 S3 恢复备份 backup_20240320_abc123
Agent: [调用 backup_restore 工具，from_remote: "backend_xxx"] 正在从远端下载并恢复...
```

**同步到云存储：**
```
用户: 将备份 backup_20240320_abc123 同步到 S3
Agent: [调用 backup_sync 工具] 已同步到远端存储

用户: 强制同步备份到 my-s3 后端
Agent: [调用 backup_sync 工具，storage: "my-s3", force: true] 强制覆盖同步完成
```

**删除备份：**
```
用户: 删除备份 backup_20240320_abc123
Agent: [调用 backup_delete 工具] 备份已删除
```

**验证备份：**
```
用户: 验证备份 backup_20240320_abc123 是否完整
Agent: [调用 backup_verify 工具] 备份验证通过，数据完整
```

**查看状态：**
```
用户: 查看备份状态
Agent: [调用 backup_status 工具] 共 5 个备份，总大小 1.2GB...
```

### 工具参数详情

#### `backup_create`

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `name` | string | 否 | 备份名称 |
| `password` | string | 否 | 加密密码 |
| `storage` | string | 否 | 存储后端 ID |

#### `backup_list`

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `type` | string | 否 | 备份类型：`all`、`native`、`clawbackup` |
| `limit` | number | 否 | 返回数量限制，默认 50 |

#### `backup_restore`

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `backup_id` | string | 是 | 要恢复的备份 ID |
| `target` | string | 否 | 恢复目标路径 |
| `password` | string | 否 | 解密密码 |

#### `backup_sync`

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `backup_id` | string | 是 | 要同步的备份 ID |
| `storage` | string | 否 | 目标存储后端 ID |
| `force` | boolean | 否 | 强制覆盖远端已存在的备份 |

#### `backup_delete`

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `backup_id` | string | 是 | 要删除的备份 ID |

#### `backup_verify`

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `backup_id` | string | 是 | 要验证的备份 ID |

#### `backup_status`

无参数。

---

## 📚 命令参考

### `openclaw clawbackup create [name]`

创建备份。

```bash
openclaw clawbackup create [name] [options]
```

**参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| `name` | string | 备份名称（可选） |

**选项：**

| 选项 | 类型 | 描述 |
|------|------|------|
| `--password <password>` | string | 加密密码，设置后将加密备份 |
| `--storage <backend>` | string | 存储后端 ID，指定后备份将保存到该后端 |
| `--output <path>` | string | 输出文件路径，自定义备份文件位置 |
| `--no-workspace` | boolean | 排除工作区目录，仅备份配置 |
| `--only-config` | boolean | 仅备份配置文件 |
| `--workspace <path...>` | string[] | 指定工作区目录（可多个） |
| `--dry-run` | boolean | 仅分析备份内容，不实际写入文件 |
| `--json` | boolean | JSON 格式输出 |

**示例：**

```bash
# 创建基本备份
openclaw clawbackup create

# 创建命名备份
openclaw clawbackup create my-backup

# 创建加密备份
openclaw clawbackup create --password mypassword

# 仅备份配置文件
openclaw clawbackup create --only-config

# 分析备份内容（不实际创建）
openclaw clawbackup create --dry-run

# 指定多个工作区目录
openclaw clawbackup create --workspace ~/project1 --workspace ~/project2

# JSON 格式输出
openclaw clawbackup create --json
```

---

### `openclaw clawbackup list`

列出所有备份。

```bash
openclaw clawbackup list [options]
```

**选项：**

| 选项 | 类型 | 描述 |
|------|------|------|
| `--type <type>` | string | 备份类型筛选：`all`（默认）、`native`、`clawbackup` |
| `--limit <number>` | number | 限制返回数量 |
| `--json` | boolean | JSON 格式输出 |

**示例：**

```bash
# 列出所有备份
openclaw clawbackup list

# 仅列出 ClawBackup 备份
openclaw clawbackup list --type clawbackup

# 限制 10 条结果
openclaw clawbackup list --limit 10

# JSON 格式输出
openclaw clawbackup list --json
```

---

### `openclaw clawbackup restore <id>`

恢复备份。

```bash
openclaw clawbackup restore <id> [options]
```

**参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| `id` | string | 备份 ID（必填） |

**选项：**

| 选项 | 类型 | 描述 |
|------|------|------|
| `--target <path>` | string | 恢复目标路径，默认恢复到原位置 |
| `--password <password>` | string | 解密密码（加密备份需要） |
| `--snapshot` | boolean | 恢复前对当前目录创建快照 |
| `--from-remote <backend>` | string | 从远端存储恢复，指定存储后端 ID |
| `--json` | boolean | JSON 格式输出 |

**示例：**

```bash
# 恢复备份到原位置
openclaw clawbackup restore backup_20240320_abc123

# 恢复到指定路径
openclaw clawbackup restore backup_20240320_abc123 --target ./restore

# 恢复加密备份
openclaw clawbackup restore backup_20240320_abc123 --password mypassword

# 恢复前创建快照
openclaw clawbackup restore backup_20240320_abc123 --snapshot

# 从远端存储恢复
openclaw clawbackup restore backup_20240320_abc123 --from-remote backend_18f3a2b

# 从远端恢复到指定路径
openclaw clawbackup restore backup_20240320_abc123 --from-remote backend_18f3a2b --target ./restore

# JSON 格式输出
openclaw clawbackup restore backup_20240320_abc123 --json
```

---

### `openclaw clawbackup sync <id>`

同步备份到远端存储。

```bash
openclaw clawbackup sync <id> [options]
```

**参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| `id` | string | 备份 ID（必填） |

**选项：**

| 选项 | 类型 | 描述 |
|------|------|------|
| `--storage <backend>` | string | 目标存储后端 ID，不指定则使用默认后端 |
| `--force` | boolean | 强制覆盖远端已存在的备份 |
| `--json` | boolean | JSON 格式输出 |

**示例：**

```bash
# 同步到默认存储后端
openclaw clawbackup sync backup_20240320_abc123

# 同步到指定存储后端
openclaw clawbackup sync backup_20240320_abc123 --storage backend_18f3a2b

# 强制覆盖
openclaw clawbackup sync backup_20240320_abc123 --force

# JSON 格式输出
openclaw clawbackup sync backup_20240320_abc123 --json
```

---

### `openclaw clawbackup delete <id>`

删除备份。

```bash
openclaw clawbackup delete <id> [options]
```

**参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| `id` | string | 备份 ID（必填） |

**选项：**

| 选项 | 类型 | 描述 |
|------|------|------|
| `--yes` | boolean | 跳过确认提示 |
| `--json` | boolean | JSON 格式输出 |

**示例：**

```bash
# 删除备份（需要确认）
openclaw clawbackup delete backup_20240320_abc123

# 跳过确认
openclaw clawbackup delete backup_20240320_abc123 --yes

# JSON 格式输出
openclaw clawbackup delete backup_20240320_abc123 --json
```

---

### `openclaw clawbackup verify <id>`

验证备份完整性。

```bash
openclaw clawbackup verify <id> [options]
```

**参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| `id` | string | 备份 ID（必填） |

**选项：**

| 选项 | 类型 | 描述 |
|------|------|------|
| `--json` | boolean | JSON 格式输出 |

**示例：**

```bash
# 验证备份
openclaw clawbackup verify backup_20240320_abc123

# JSON 格式输出
openclaw clawbackup verify backup_20240320_abc123 --json
```

---

### `openclaw clawbackup status`

查看备份状态概览。

```bash
openclaw clawbackup status [options]
```

**选项：**

| 选项 | 类型 | 描述 |
|------|------|------|
| `--json` | boolean | JSON 格式输出 |

**示例：**

```bash
# 查看状态
openclaw clawbackup status

# JSON 格式输出
openclaw clawbackup status --json
```

---

### `openclaw clawbackup backends`

存储后端管理。

```bash
openclaw clawbackup backends [command]
```

**子命令：**

#### `backends` - 列出存储后端

```bash
openclaw clawbackup backends
```

输出示例：
```
已配置的存储后端：

  [local] 本地存储 (local)
      路径: 默认

使用 'clawbackup backends add' 添加新的存储后端
使用 'clawbackup backends remove <id>' 删除存储后端
```

#### `backends add` - 添加存储后端

```bash
openclaw clawbackup backends add
```

交互式输入：
- **存储类型**：`s3`
- **显示名称**：自定义名称（如：我的 AWS S3）
- **端点**：S3 兼容端点（如：`https://s3.amazonaws.com`）
- **区域**：区域（如：`us-east-1`）
- **存储桶名称**：Bucket 名称
- **Access Key ID**：访问密钥 ID
- **Secret Access Key**：访问密钥
- **存储前缀**：可选，存储路径前缀
- **设为默认**：是否设为默认存储后端

**支持的存储服务：**

| 服务 | 端点示例 | 区域示例 |
|------|----------|----------|
| AWS S3 | `https://s3.amazonaws.com` | `us-east-1` |
| 阿里云 OSS | `https://oss-cn-hangzhou.aliyuncs.com` | `oss-cn-hangzhou` |
| 腾讯云 COS | `https://cos.ap-guangzhou.myqcloud.com` | `ap-guangzhou` |
| MinIO | `http://localhost:9000` | `us-east-1` |

#### `backends remove <backendId>` - 删除存储后端

```bash
openclaw clawbackup backends remove <backendId>
```

**示例：**

```bash
openclaw clawbackup backends remove backend_18f3a2b
```

---

### `openclaw clawbackup init`

初始化 ClawBackup 配置。

```bash
openclaw clawbackup init
```

创建默认配置目录和文件。

---

## 💾 存储后端配置

### 本地存储

默认存储后端，备份保存在 `~/.openclaw/clawbackups/` 目录。

### S3 兼容存储

支持 AWS S3、阿里云 OSS、腾讯云 COS、MinIO 等 S3 兼容存储服务。

**配置示例（阿里云 OSS）：**

```bash
openclaw clawbackup backends add
```

输入：
- 端点：`https://oss-cn-hangzhou.aliyuncs.com`
- 区域：`oss-cn-hangzhou`
- 存储桶：`my-backup-bucket`
- Access Key ID：你的 AccessKey ID
- Secret Access Key：你的 AccessKey Secret

**安全说明：**

敏感信息（Access Key ID、Secret Access Key）使用 AES-256-GCM 加密存储。加密密钥保存在 `~/.openclaw/clawbackups/.encryption_key` 文件中。

可以通过环境变量 `CLAWBACKUP_ENCRYPTION_KEY` 指定加密密钥。

---

## 📦 备份内容

ClawBackup 备份以下内容：

| 内容 | 描述 |
|------|------|
| OpenClaw 配置 | `~/.openclaw/openclaw.json` 及相关配置 |
| 工作区 | `~/.openclaw/workspace/` 目录 |
| 会话数据 | `~/.openclaw/sessions/` 目录 |
| 凭证 | `~/.openclaw/credentials/` 目录（可选） |

---

## 🔄 工作流示例

### 日常备份

```bash
# 创建备份
openclaw clawbackup create daily-backup

# 同步到云存储
openclaw clawbackup sync <backup_id> --storage my-s3
```

### 灾难恢复

```bash
# 查看可用备份
openclaw clawbackup list

# 从云存储恢复
openclaw clawbackup restore <backup_id> --from-remote my-s3 --target ./recovery
```

### 迁移到新机器

```bash
# 机器 A：创建备份并同步到云存储
openclaw clawbackup create migration-backup
openclaw clawbackup sync <backup_id> --storage my-s3

# 机器 B：从云存储恢复
openclaw clawbackup restore <backup_id> --from-remote my-s3
```

---

## ⚙️ 配置文件

### 备份索引

备份元数据保存在 `~/.openclaw/clawbackups/index.json`。

### 存储后端配置

存储后端配置保存在 `~/.openclaw/clawbackends/backends.json`。

### 加密密钥

加密密钥保存在 `~/.openclaw/clawbackends/.encryption_key`。

---

## 📄 许可证

Apache License 2.0

详见 [LICENSE](LICENSE) 文件。

### 免责声明

本软件按"原样"提供，不附带任何明示或暗示的保证。在任何情况下，作者或版权持有人均不对因使用本软件而产生的任何索赔、损害或其他责任负责。

**重要提示**：本软件处理数据备份和恢复操作。用户需自行负责：
- 验证备份完整性
- 测试恢复流程
- 保留多个备份副本
- 可能发生的任何数据丢失或损坏
