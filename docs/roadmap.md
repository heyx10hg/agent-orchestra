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
- [x] Claude Code adapter 实现（`packages/adapters`）
  - 可用性检测（`claude --version`）
  - 无头模式封装（`claude -p --output-format stream-json --verbose`）
  - 输出解析与标准化（增量式 NDJSON 解析器）
  - ProviderProfile 路由（按 agent 注入 `ANTHROPIC_*` 环境变量）
- [x] 消息格式定稿（`packages/core`）
  - MessageEnvelope 类型定义（zod schema）
  - 消息验证逻辑
  - 序列化/反序列化
- [x] CLI 入口（`packages/cli`）
  - 基础命令行参数解析（`node:util` parseArgs）
  - 任务配置加载（YAML + zod 校验）
  - 单 agent 任务执行（含 `--dry-run`）
- [x] 测试用例（vitest，32 项）
  - Adapter 单元测试（注入伪 spawn，不触发真实 CLI）
  - 消息格式测试
  - 端到端测试（`RUN_E2E=1` 门控，默认跳过）

**验收标准**：
- [x] 能通过 CLI 启动一个 Claude Code agent
- [x] Agent 能接收任务、执行、返回结果
- [x] 消息格式符合设计规范

**状态**：✅ 已完成

---

## M2：第二个 adapter + 双 agent 通信

**目标**：实现多 agent 通信闭环

**交付物**：
- [x] 第二个 adapter（OpenCode，`opencode run --format json`，已接入 MiMo token plan，真实 e2e 通过且 cost 0）
- [x] CLI 按 `platform` 选择 adapter（`adapterFor`，跨平台接入点）
- [x] Message Bus 实现
  - 消息存储（InMemory + JSONL 追加日志持久化）
  - 消息查询（按 from / to / type 过滤）
- [x] Leader-Worker 通信
  - 任务分发（leader 拆解 → task 消息）
  - 进度汇报（worker → report 消息）
  - 评审决策（可选 --review → decision 消息）
- [x] Orchestrator 核心（`runLeaderWorker` 闭环）
  - 顺序回合调度
  - runAgent 统一 agent 生命周期（start→send→stream→stop）
  - 基础错误处理（isError 透传）
- [x] CLI `orchestrate` 子命令
- [ ] 真实双 agent 闭环已验证（leader+worker 同 MiMo 跑通，cost 0；跨平台 official+MiMo 有门控 e2e）

**验收标准**：
- [x] 两个不同平台的 agent 可以通信（adapter 各自真实 e2e 通过）
- [x] Leader 可以向 Worker 分发任务（task 消息流经总线）
- [x] Worker 可以向 Leader 汇报进度（report 消息回流）
- [x] 消息传递可靠，无丢失（JSONL 持久化，可回放）

**状态**：✅ 核心已完成（真实跨平台双 agent e2e 由 `RUN_E2E=1` 触发）

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
| M1 | 第一个 adapter + 单 agent | 第 2-3 周 | ✅ 已完成 |
| M2 | 第二个 adapter + 双 agent | 第 4-5 周 | ⏳ 待开始 |
| M3 | Blackboard 与工作区管理 | 第 6-7 周 | ⏳ 待开始 |
| M4 | TUI 监控面板 + 配额感知 | 第 8-9 周 | ⏳ 待开始 |

> **注意**：时间表为预估，实际进度可能根据开发情况调整。
