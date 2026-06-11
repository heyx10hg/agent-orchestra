# 任务：初始化「agent-orchestra」开源项目仓库（仅脚手架，不写实现代码）

## 你的角色

你是一名资深开源项目工程师，负责为一个新项目搭建规范的仓库脚手架、初始化 git 并发布到 GitHub。本次任务**只做目录结构、文档和 git/GitHub 配置**，不编写任何业务实现代码。

## 项目背景（用于写入 README 和文档）

agent-orchestra 是一个本地多 agent 协同编排工具，要解决的问题是：

- 能力领先的大模型 API 按 token 计费过于昂贵，而写代码恰恰是 token 消耗大户；
- Claude Code、Codex CLI、OpenCode、Gemini CLI 等订阅制 coding agent 以固定月费提供同等甚至更强的能力；
- 市面上的多 agent 框架（MetaGPT、CrewAI、AutoGen 等）全部走 API 计费，而扣子、Cherry Studio 之类产品只是工作流编排或聊天客户端，都没有实现 coding agent 之间的真实相互通信。

本项目在这些订阅制 agent CLI 之上构建一个编排层：

1. 为每个 agent 实例分配角色（leader / 前端 / 后端 / 测试 / 评审……），角色用 YAML 声明式定义；
2. 通过本地消息总线让 agent 真正相互通信：leader 拆解任务并派活，worker 汇报进度，agent 之间可以互相提问和评审；
3. 通过共享黑板（任务板、决策日志、接口契约文档）+ git worktree 隔离工作区，让多个 agent 并行写码而不互相踩踏；
4. 适配层（adapter）统一封装各平台的无头模式（如 `claude -p --output-format stream-json`、`codex exec`、`opencode serve` 等；文档中接口细节一律标注"以各平台官方文档为准"）。

**定位与合规红线**：这是个人与小团队的**本地**编排工具，利用使用者自己已付费的订阅额度；明确不做账号池、不做订阅转售、不把订阅包装成对外 API 服务。此声明必须写进 README。

技术栈：TypeScript / Node.js (>= 20)，pnpm monorepo。

## 工作目录

`~/Documents/multi-agent`（目录已存在且为空，直接在其中初始化，**不要**新建子目录套一层）。

## 要创建的目录结构

```
multi-agent/
├── README.md
├── LICENSE                      # Apache-2.0，版权人姓名留 <YOUR NAME> 占位
├── .gitignore                   # Node + macOS (.DS_Store) + Windows (Thumbs.db) + 常见 IDE
├── .gitattributes               # * text=auto eol=lf （统一 Mac/Windows 换行）
├── .editorconfig
├── package.json                 # private: true，monorepo 根
├── pnpm-workspace.yaml          # packages/*
├── tsconfig.base.json
├── docs/
│   ├── architecture.md
│   ├── roadmap.md
│   └── risks.md
├── examples/
│   └── team.example.yaml
└── packages/
    ├── core/                    # 占位：package.json + README.md 一句话说明（编排器与消息总线）
    ├── adapters/                # 占位：package.json + README.md 一句话说明（各平台适配器）
    └── cli/                     # 占位：package.json + README.md 一句话说明（命令行入口）
```

## 各文件内容要求

所有文档以中文为主，技术名词保留英文，中英文之间留空格。

**README.md**：
- 一句话简介 + 痛点与动机（按上面"项目背景"展开）；
- 架构概览图（mermaid），展示 Orchestrator、Adapters、Message Bus、Blackboard、Git Worktrees 五个部分和数据流向；
- 路线图摘要（链接到 docs/roadmap.md）；
- "多端开发"小节（内容见下方"跨平台同步说明"）；
- 合规免责声明（遵守各 agent 平台服务条款，仅限本地个人/团队使用）。

**docs/architecture.md**（hub-and-spoke 架构详述）：
- **Orchestrator**：核心守护进程，负责回合调度、消息路由、配额感知（订阅计划有用量窗口限制，需排队与降级）；
- **Adapter**（每平台一个）：把平台 CLI 的无头模式封装成统一接口 `start / send / stream / stop`，并处理登录态检测与版本兼容；
- **Message Bus**：本地实现（SQLite 或 JSONL 追加日志），消息 envelope 字段：`id, from, to, role, type (task|report|review|question|decision), payload, ts`；注明 envelope 设计向 A2A / ACP 协议靠拢，未来可做翻译层接入生态；
- **Blackboard**：共享 markdown 黑板（任务板 TASKS.md、决策日志 DECISIONS.md、接口契约 CONTRACTS.md），解决各 agent 上下文窗口互相隔离、只靠消息会失真的问题；
- **Workspace Manager**：每个 agent 一个 git worktree 分支，leader 角色负责审查与合并，从机制上避免并发修改冲突。

**docs/roadmap.md**：
- M0 仓库脚手架与文档（本次任务）；
- M1 第一个 adapter（Claude Code headless）+ 消息格式定稿 + CLI 单 agent 跑通一个任务；
- M2 第二个 adapter（OpenCode 或 Codex CLI）+ leader-worker 双 agent 通信闭环；
- M3 Blackboard 与 git worktree 工作区管理；
- M4 TUI 监控面板 + 配额感知调度。

**docs/risks.md**：四大风险及对策——平台 ToS 合规边界；CLI 接口不稳定（输出格式/登录态随版本变化，需兼容层）；多 agent 上下文割裂（靠 Blackboard 缓解）；订阅用量限额（配额感知 + 排队）。

**examples/team.example.yaml**：角色定义示例，体现声明式配置：

```yaml
team: demo-webapp
agents:
  - name: leader
    platform: claude-code
    role: 技术负责人，拆解任务、分派、评审与合并
    permissions: [plan, review, merge]
  - name: frontend
    platform: opencode
    role: 前端工程师，只改 web/ 目录
    permissions: [code]
  - name: backend
    platform: codex
    role: 后端工程师，只改 server/ 目录
    permissions: [code]
maxConcurrent: 2
```

## Git 与 GitHub 步骤

1. `git init -b main`；
2. 确认 `git config user.name` / `user.email` 已配置，未配置则提示我提供；
3. `git add -A`，首次提交信息：`chore: 初始化项目脚手架与文档`（遵循 Conventional Commits）；
4. 发布到 GitHub，优先用 gh CLI：
   - 先 `gh auth status` 检查登录；
   - `gh repo create agent-orchestra --public --source=. --push`；
   - 若仓库名已被占用，与我确认备选名（如 agent-orchestra-dev）；
5. 若没有 gh 或未登录，则给出手动步骤并暂停等我操作：GitHub 网页新建**空仓库**（不要勾选 README/.gitignore/license）→ `git remote add origin git@github.com:<用户名>/agent-orchestra.git` → `git push -u origin main`；
6. 验证：`git status` 工作区干净；`git ls-remote origin` 能列出 main。

## 跨平台同步说明（写入 README 的"多端开发"小节）

- Mac 端即本仓库；Windows 端直接 `git clone`，换行符由 `.gitattributes` 统一为 LF，**不要**在 Windows 上设置 `core.autocrlf=true`；
- 两端各自生成 SSH key 并添加到 GitHub 账户；
- 协作习惯：每次开始工作前 `git pull --rebase`，结束后及时 push；避免两端同时修改同一区域。

## 约束与禁止事项

- 不编写任何 orchestrator / adapter 的实现代码，packages 下只放占位 package.json 和 README；
- 不要 force push；不要创建 main 以外的分支；
- 每个关键步骤执行后展示命令输出；任何一步失败就停下来报告原因，不要自行猜测绕过；
- 不要安装除 pnpm 以外的全局依赖。

## 完成标准

- 目录结构与上述清单一致，文档内容完整无 TODO 占位；
- GitHub 上可以看到仓库和全部文件；
- 最后输出：仓库 URL、Windows 端克隆命令、以及一段 50 字以内的"下一步建议"（指向 M1）。
