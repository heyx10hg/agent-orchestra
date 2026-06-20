import type { AgentAdapter, AgentConfig, AgentOutput, TokenUsage } from './agent.js';
import { createMessage, type MessageEnvelope } from './message.js';
import type { MessageBus } from './message-bus.js';
import { collectRun } from './run-agent.js';
import type { WorkspaceManager } from './workspace.js';
import type { Blackboard } from './blackboard.js';

export interface OrchestratorOptions {
  /** 消息总线，所有 agent 间消息流经此处 */
  bus: MessageBus;
  /** 按 agent 配置解析出对应平台的 adapter */
  resolveAdapter: (config: AgentConfig) => AgentAdapter;
  /** 是否在 worker 汇报后让 leader 评审并产出 decision */
  review?: boolean;
  /** 覆盖各 agent 的工作目录（纯对话场景指向空目录可省下探索 repo 的开销） */
  cwd?: string;
  /** 工作区管理器（coding 流程用，为 worker 分配 worktree） */
  workspace?: WorkspaceManager;
  /** 共享黑板（记录任务与决策） */
  blackboard?: Blackboard;
  /** 流式输出回调，用于实时打印各 agent 的过程 */
  onOutput?: (agent: AgentConfig, output: AgentOutput) => void;
}

export interface CodingTaskRun {
  leader: AgentConfig;
  worker: AgentConfig;
  task: string;
  /** leader 评审通过后是否自动合并 worker 分支，默认 false */
  autoMerge?: boolean;
}

export interface CodingTaskResult {
  messages: MessageEnvelope[];
  usage: TokenUsage;
  /** worker 的 worktree 路径与分支 */
  worktree: { path: string; branch: string };
  /** worker 是否产生了改动 */
  hasChanges: boolean;
  /** leader 是否评审通过 */
  approved: boolean;
  /** 是否已合并到主分支 */
  merged: boolean;
}

export interface LeaderWorkerRun {
  leader: AgentConfig;
  worker: AgentConfig;
  task: string;
  /** worker↔leader 问答最大轮数（封顶 token 消耗），默认 3 */
  maxRounds?: number;
}

export interface OrchestrationResult {
  messages: MessageEnvelope[];
  /** 本次协同累计 token 用量 */
  usage: TokenUsage;
  /** 实际进行的 worker 轮数 */
  rounds: number;
}

function addUsage(acc: TokenUsage, u?: TokenUsage): void {
  if (!u) return;
  if (u.input != null) acc.input = (acc.input ?? 0) + u.input;
  if (u.output != null) acc.output = (acc.output ?? 0) + u.output;
  if (u.total != null) acc.total = (acc.total ?? 0) + u.total;
}

/** 朴素判断 worker 的输出是否是在向 leader 提问（含问号即视为提问） */
export function looksLikeQuestion(text: string): boolean {
  return /[?？]/.test(text);
}

/** 朴素判断 leader 的评审是否通过 */
export function looksApproved(text: string): boolean {
  return /(通过|approve|lgtm|可以合并|同意)/i.test(text) && !/(不通过|reject|不可以|拒绝)/i.test(text);
}

/**
 * 最小可用编排器：实现 leader → worker（多轮问答）→ leader 评审的协同闭环。
 *
 * 「真实相互通信」的落点——worker 执行的是 leader 拆解、经消息总线传递的指令；
 * 当 worker 反问时，问题作为 question 消息回流 leader，leader 的回答再经总线送回，
 * worker 在同一会话内继续（依赖 adapter 的会话续接，避免每轮重建上下文）。
 * 两个 agent 可以是不同平台、不同模型来源。
 */
export class Orchestrator {
  constructor(private readonly options: OrchestratorOptions) {}

  async runLeaderWorker({ leader, worker, task, maxRounds = 3 }: LeaderWorkerRun): Promise<OrchestrationResult> {
    const { bus, resolveAdapter, onOutput, cwd } = this.options;
    const leaderCfg = cwd ? { ...leader, cwd } : leader;
    const workerCfg = cwd ? { ...worker, cwd } : worker;
    const leaderAdapter = resolveAdapter(leaderCfg);
    const workerAdapter = resolveAdapter(workerCfg);
    const leaderSession = await leaderAdapter.start(leaderCfg);
    const workerSession = await workerAdapter.start(workerCfg);

    const usage: TokenUsage = {};
    let rounds = 0;

    try {
      // 1) leader 把用户任务拆解为给 worker 的明确指令
      const decomposePrompt =
        `你是团队 leader（角色：${leader.role}）。把下面的任务拆解成一条给 worker` +
        `「${worker.name}」（${worker.role}）的明确、可执行指令。只输出指令本身，不要解释：\n\n${task}`;
      const decompose = await collectRun(leaderAdapter, leaderSession, decomposePrompt, (o) => onOutput?.(leaderCfg, o));
      addUsage(usage, decompose.usage);
      const instruction = decompose.answer;
      bus.publish(
        createMessage({ from: leader.name, to: worker.name, role: leader.role, type: 'task', payload: { instruction } }),
      );

      // 2) worker 执行；如反问则与 leader 多轮往返，直至产出汇报或达到轮数上限
      let nextMessage = `你是 ${worker.role}。请完成 leader 通过编排器分派的任务：\n\n${instruction}`;
      let finalReport = '';
      while (true) {
        rounds++;
        const work = await collectRun(workerAdapter, workerSession, nextMessage, (o) => onOutput?.(workerCfg, o));
        addUsage(usage, work.usage);

        if (looksLikeQuestion(work.answer) && rounds < maxRounds) {
          bus.publish(
            createMessage({
              from: worker.name,
              to: leader.name,
              role: worker.role,
              type: 'question',
              payload: { question: work.answer },
            }),
          );
          const answerPrompt =
            `worker「${worker.name}」提出疑问：\n\n${work.answer}\n\n请作为 leader 直接回答，让它能继续推进。只输出回答。`;
          const answer = await collectRun(leaderAdapter, leaderSession, answerPrompt, (o) => onOutput?.(leaderCfg, o));
          addUsage(usage, answer.usage);
          bus.publish(
            createMessage({ from: leader.name, to: worker.name, role: leader.role, type: 'task', payload: { answer: answer.answer } }),
          );
          nextMessage = `leader 回复了你的疑问：\n\n${answer.answer}\n\n请据此继续并完成任务。`;
          continue;
        }

        finalReport = work.answer;
        bus.publish(
          createMessage({ from: worker.name, to: leader.name, role: worker.role, type: 'report', payload: { report: finalReport } }),
        );
        break;
      }

      // 3) 可选：leader 评审 worker 的汇报并产出决策
      if (this.options.review) {
        const reviewPrompt =
          `worker「${worker.name}」完成并汇报如下：\n\n${finalReport}\n\n` +
          `请作为 leader 评审是否达标，简要给出结论与后续动作。`;
        const reviewRun = await collectRun(leaderAdapter, leaderSession, reviewPrompt, (o) => onOutput?.(leaderCfg, o));
        addUsage(usage, reviewRun.usage);
        bus.publish(
          createMessage({ from: leader.name, to: worker.name, role: leader.role, type: 'decision', payload: { decision: reviewRun.answer } }),
        );
      }

      return { messages: bus.list(), usage, rounds };
    } finally {
      await leaderAdapter.stop(leaderSession);
      await workerAdapter.stop(workerSession);
    }
  }

  /**
   * Coding 协同：worker 在专属 git worktree 内写真实代码，leader 审查 diff，
   * 通过则可合并回主分支。任务与决策记录到黑板。
   *
   * 这是「多 agent 并行写码而不互相踩踏」的落点：每个 worker 一个隔离工作区，
   * 由 leader 统一审查合并。
   */
  async runCodingTask({ leader, worker, task, autoMerge = false }: CodingTaskRun): Promise<CodingTaskResult> {
    const { bus, resolveAdapter, onOutput, workspace, blackboard } = this.options;
    if (!workspace) throw new Error('runCodingTask 需要在 OrchestratorOptions 中提供 workspace');

    const usage: TokenUsage = {};
    blackboard?.addTask(leader.name, task);

    const worktree = workspace.createWorktree(worker.name);

    // leader 在目标仓库根目录工作（审查/合并），避免继承编排器自身的目录
    const leaderCfg: AgentConfig = { ...leader, cwd: leader.cwd ?? workspace.repoDir };
    const leaderAdapter = resolveAdapter(leaderCfg);
    const leaderSession = await leaderAdapter.start(leaderCfg);
    // worker 在 worktree 内工作，并放开编辑权限
    const workerCfg: AgentConfig = {
      ...worker,
      cwd: worktree.path,
      permissionMode: worker.permissionMode ?? 'acceptEdits',
    };
    const workerAdapter = resolveAdapter(workerCfg);
    const workerSession = await workerAdapter.start(workerCfg);

    try {
      // 1) leader 拆解任务
      const decompose = await collectRun(
        leaderAdapter,
        leaderSession,
        `你是团队 leader（${leader.role}）。把下面的任务拆解成给 worker「${worker.name}」（${worker.role}）的明确编码指令，只输出指令本身：\n\n${task}`,
        (o) => onOutput?.(leader, o),
      );
      addUsage(usage, decompose.usage);
      const instruction = decompose.answer;
      bus.publish(
        createMessage({ from: leader.name, to: worker.name, role: leader.role, type: 'task', payload: { instruction } }),
      );
      blackboard?.addTask(worker.name, instruction);

      // 2) worker 在 worktree 内写代码（强调真正调用文件工具写入，而非口头描述）
      const work = await collectRun(
        workerAdapter,
        workerSession,
        `你是 ${worker.role}。请使用你的文件读写工具，在当前工作目录中**真正创建/修改文件**来完成下面的任务。` +
          `必须实际写入文件，不要只用文字描述你会怎么做：\n\n${instruction}`,
        (o) => onOutput?.(workerCfg, o),
      );
      addUsage(usage, work.usage);
      bus.publish(
        createMessage({ from: worker.name, to: leader.name, role: worker.role, type: 'report', payload: { report: work.answer } }),
      );

      // 把 worker 的未提交改动落盘提交；worker 也可能已自行 commit（两种都算改动）
      workspace.commitIfDirty(worktree.path, `feat(${worker.name}): ${task}`);
      const hasChanges = workspace.hasChanges(worktree.path, worktree.base);
      const changes = hasChanges ? workspace.diff(worktree.path, worktree.base) : '(worker 未产生任何文件改动)';

      // 3) leader 审查 diff
      const reviewRun = await collectRun(
        leaderAdapter,
        leaderSession,
        `worker 在隔离工作区完成了改动，相对基线的 diff 如下：\n\n${changes}\n\n请审查：达标则回复「通过」并简述，否则回复「不通过」并指出问题。`,
        (o) => onOutput?.(leader, o),
      );
      addUsage(usage, reviewRun.usage);
      const approved = looksApproved(reviewRun.answer);
      bus.publish(
        createMessage({
          from: leader.name,
          to: worker.name,
          role: leader.role,
          type: 'decision',
          payload: { approved, decision: reviewRun.answer },
        }),
      );
      blackboard?.addDecision(leader.name, `${approved ? '通过' : '不通过'}：${reviewRun.answer}`);

      // 4) 通过且要求自动合并则合并（改动此时已是分支上的提交）
      let merged = false;
      if (hasChanges && approved && autoMerge) {
        workspace.merge(worktree.branch);
        merged = true;
      }

      return { messages: bus.list(), usage, worktree, hasChanges, approved, merged };
    } finally {
      await leaderAdapter.stop(leaderSession);
      await workerAdapter.stop(workerSession);
    }
  }
}
