# Contributing to ClawBackup

感谢你考虑为 ClawBackup 做出贡献！

## 如何贡献

### 报告 Bug

如果你发现了 bug，请通过 [GitHub Issues](https://github.com/ClawBackup-AI/ClawBackup/issues) 提交报告。提交时请包含：

- 操作系统和 Node.js 版本
- OpenClaw 版本
- 重现步骤
- 期望行为和实际行为
- 相关日志（如有）

### 提出新功能

欢迎提出新功能建议！请在 Issue 中描述：

- 功能描述
- 使用场景
- 预期行为

### 提交代码

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 代码规范

- 使用 TypeScript
- 遵循现有的代码风格
- 添加必要的测试
- 更新相关文档

### 开发设置

```bash
# 克隆仓库
git clone https://github.com/ClawBackup-AI/ClawBackup.git
cd ClawBackup

# 安装依赖
npm install

# 运行测试
npm test

# 代码检查
npm run lint

# 类型检查
npm run typecheck

# 构建
npm run build
```

## 许可证

通过贡献代码，你同意你的贡献将根据 Apache License 2.0 许可证授权。
