import type { AgentAdapter, AgentConfig, AgentOutput } from './agent.js';
import { createMessage, type MessageEnvelope } from './message.js';
import type { MessageBus } from './message-bus.js';
import { runAgent } from './run-agent.js';

export interface OrchestratorOptions {
  /** 消息总线，所有 agent 间消息流经此处 */
  bus: MessageBus;
  /** 按 agent 配置解析出对应平台的 adapter */
  resolveAdapter: (config: AgentConfig) => AgentAdapter;
  /** 是否在 worker 汇报后让 leader 评审并产出 decision */
  review?: boolean;
  /** 流式输出回调，用于实时打印各 agent 的过程 */
  onOutput?: (agent: AgentConfig, output: AgentOutput) => void;
}

export interface LeaderWorkerRun {
  leader: AgentConfig;
  worker: AgentConfig;
  task: string;
}

/**
 * 最小可用编排器：实现 leader → worker（→ leader 评审）的协同闭环。
 *
 * 这是「真实相互通信」的落点——worker 执行的是 leader 拆解后、经消息总线
 * 传递的指令，而非用户原始任务；汇报同样回流至 leader。两个 agent 可以是
 * 不同平台、不同模型来源（如 Claude Code leader + OpenCode/MiMo worker）。
 */
export class Orchestrator {
  constructor(private readonly options: OrchestratorOptions) {}

  async runLeaderWorker({ leader, worker, task }: LeaderWorkerRun): Promise<MessageEnvelope[]> {
    const { bus, resolveAdapter, onOutput } = this.options;
    const leaderAdapter = resolveAdapter(leader);
    const workerAdapter = resolveAdapter(worker);

    // 1) leader 把用户任务拆解为给 worker 的明确指令
    const decomposePrompt =
      `你是团队 leader（角色：${leader.role}）。把下面的任务拆解成一条给 worker` +
      `「${worker.name}」（${worker.role}）的明确、可执行指令。只输出指令本身，不要解释：\n\n${task}`;
    const decompose = await runAgent(leaderAdapter, leader, decomposePrompt, (o) => onOutput?.(leader, o));
    const instruction = decompose.answer;
    bus.publish(
      createMessage({ from: leader.name, to: worker.name, role: leader.role, type: 'task', payload: { instruction } }),
    );

    // 2) worker 执行 leader 派发的指令并汇报
    const workPrompt = `你是 ${worker.role}。请完成 leader 通过编排器分派的任务：\n\n${instruction}`;
    const work = await runAgent(workerAdapter, worker, workPrompt, (o) => onOutput?.(worker, o));
    const report = work.answer;
    bus.publish(
      createMessage({ from: worker.name, to: leader.name, role: worker.role, type: 'report', payload: { report } }),
    );

    // 3) 可选：leader 评审 worker 的汇报并产出决策
    if (this.options.review) {
      const reviewPrompt =
        `worker「${worker.name}」完成了任务并汇报如下：\n\n${report}\n\n` +
        `请作为 leader 评审是否达标，简要给出结论与后续动作。`;
      const reviewRun = await runAgent(leaderAdapter, leader, reviewPrompt, (o) => onOutput?.(leader, o));
      bus.publish(
        createMessage({
          from: leader.name,
          to: worker.name,
          role: leader.role,
          type: 'decision',
          payload: { decision: reviewRun.answer },
        }),
      );
    }

    return bus.list();
  }
}
