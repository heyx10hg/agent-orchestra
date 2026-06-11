# 路线图

本文档描述 Agent Orchestra 的开发路线图。

## M0：仓库脚手架与文档

**目标**：建立项目基础结构和文档体系

**交付物**：
- [x] 项目目录结构
- [x] 根目录配置文件（.gitignore, .gitattributes, .editorconfig）
- [x] pnpm monorepo 配置
- [x] TypeScript 基础配置
- [x] README.md（项目介绍、架构概览、合规声明）
- [x] 架构文档（docs/architecture.md）
- [x] 路线图文档（docs/roadmap.md）
- [x] 风险文档（docs/risks.md）
- [x] 示例配置（examples/team.example.yaml）
- [x] 子包占位（packages/core, packages/adapters, packages/cli）

**状态**：✅ 已完成

---

## M1：第一个 adapter + 单 agent 跑通

**目标**：实现 Claude Code adapter，让单个 agent 完成一个完整任务

**交付物**：
- [ ] Claude Code adapter 实现
  - 登录态检测
  - 无头模式封装（`claude -p --output-format stream-json`）
  - 输出解析与标准化
- [ ] 消息格式定稿
  - MessageEnvelope 类型定义
  - 消息验证逻辑
  - 序列化/反序列化
- [ ] CLI 入口
  - 基础命令行参数解析
  - 任务配置加载
  - 单 agent 任务执行
- [ ] 测试用例
  - Adapter 单元测试
  - 消息格式测试
  - 端到端测试

**验收标准**：
- 能通过 CLI 启动一个 Claude Code agent
- Agent 能接收任务、执行、返回结果
- 消息格式符合设计规范

---

## M2：第二个 adapter + 双 agent 通信

**目标**：实现多 agent 通信闭环

**交付物**：
- [ ] 第二个 adapter（OpenCode 或 Codex CLI）
- [ ] Message Bus 实现
  - 消息存储（SQLite 或 JSONL）
  - 消息路由
  - 消息查询
- [ ] Leader-Worker 通信
  - 任务分发
  - 进度汇报
  - 问答交互
- [ ] Orchestrator 核心
  - 回合调度
  - Agent 生命周期管理
  - 基础错误处理

**验收标准**：
- 两个不同平台的 agent 可以通信
- Leader 可以向 Worker 分发任务
- Worker 可以向 Leader 汇报进度
- 消息传递可靠，无丢失

---

## M3：Blackboard 与工作区管理

**目标**：实现共享上下文和工作区隔离

**交付物**：
- [ ] Blackboard 实现
  - TASKS.md 管理
  - DECISIONS.md 管理
  - CONTRACTS.md 管理
  - 并发控制
- [ ] Workspace Manager
  - Git worktree 创建/删除
  - 分支管理
  - 代码审查流程
  - 合并策略
- [ ] 集成测试
  - 多 agent 并行工作
  - 冲突检测与解决
  - 黑板一致性验证

**验收标准**：
- 多个 agent 可以同时在独立分支工作
- Blackboard 内容在所有 agent 间同步
- Leader 可以审查并合并 Worker 的代码
- 无并发冲突

---

## M4：TUI 监控面板 + 配额感知

**目标**：提供可视化监控和智能调度

**交付物**：
- [ ] TUI 监控面板
  - 实时消息流展示
  - Agent 状态监控
  - 任务进度追踪
  - 日志查看
- [ ] 配额感知调度
  - 各平台用量监控
  - 用量窗口限制处理
  - 智能排队策略
  - 降级策略
- [ ] 配置优化
  - 动态配置加载
  - 配置验证
  - 配置示例

**验收标准**：
- TUI 面板可以实时显示系统状态
- 系统能自动处理平台用量限制
- 配额不足时能智能降级或排队
- 用户体验流畅，无卡顿

---

## 未来展望

### 长期目标

- **更多平台适配**：支持更多 coding agent 平台
- **协议标准化**：支持 A2A、ACP 等标准协议
- **云端协作**：支持远程 agent 协作
- **插件系统**：支持用户自定义扩展

### 社区建设

- **文档完善**：提供更多教程和示例
- **贡献指南**：降低参与门槛
- **问题追踪**：及时响应社区反馈
- **版本发布**：定期发布稳定版本

---

## 里程碑时间表

| 里程碑 | 目标 | 预计时间 | 状态 |
|--------|------|---------|------|
| M0 | 仓库脚手架与文档 | 第 1 周 | ✅ 已完成 |
| M1 | 第一个 adapter + 单 agent | 第 2-3 周 | 🔄 进行中 |
| M2 | 第二个 adapter + 双 agent | 第 4-5 周 | ⏳ 待开始 |
| M3 | Blackboard 与工作区管理 | 第 6-7 周 | ⏳ 待开始 |
| M4 | TUI 监控面板 + 配额感知 | 第 8-9 周 | ⏳ 待开始 |

> **注意**：时间表为预估，实际进度可能根据开发情况调整。
