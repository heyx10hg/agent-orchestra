import type { AgentAdapter, AgentConfig, AgentOutput, TokenUsage } from './agent.js';
import { createMessage, type MessageEnvelope } from './message.js';
import type { MessageBus } from './message-bus.js';
import { collectRun } from './run-agent.js';

export interface OrchestratorOptions {
  /** 消息总线，所有 agent 间消息流经此处 */
  bus: MessageBus;
  /** 按 agent 配置解析出对应平台的 adapter */
  resolveAdapter: (config: AgentConfig) => AgentAdapter;
  /** 是否在 worker 汇报后让 leader 评审并产出 decision */
  review?: boolean;
  /** 覆盖各 agent 的工作目录（纯对话场景指向空目录可省下探索 repo 的开销） */
  cwd?: string;
  /** 流式输出回调，用于实时打印各 agent 的过程 */
  onOutput?: (agent: AgentConfig, output: AgentOutput) => void;
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
}
