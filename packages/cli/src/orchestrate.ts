import {
  Orchestrator,
  JsonlMessageBus,
  type AgentConfig,
  type AgentOutput,
  type MessageEnvelope,
} from '@agent-orchestra/core';
import { loadTeamConfig, selectAgent, type TeamConfig } from './config.js';
import { adapterFor } from './run.js';

const LEADER_PERMISSIONS = ['plan', 'review', 'merge'];

/** 选 leader：优先有 plan/review/merge 权限的 agent，否则取第一个 */
export function pickLeader(config: TeamConfig): AgentConfig {
  return (
    config.agents.find((a) => a.permissions?.some((p) => LEADER_PERMISSIONS.includes(p))) ?? config.agents[0]
  );
}

/** 选 worker：第一个不是 leader 的 agent */
export function pickWorker(config: TeamConfig, leader: AgentConfig): AgentConfig | undefined {
  return config.agents.find((a) => a.name !== leader.name);
}

export interface OrchestrateOptions {
  configPath: string;
  leaderName?: string;
  workerName?: string;
  busPath?: string;
  review?: boolean;
  maxRounds?: number;
  /** 覆盖 agent 工作目录（纯对话场景指向空目录省 token） */
  cwd?: string;
  log?: (line: string) => void;
}

/** 执行 leader→worker 协同：加载配置 → 选角色 → 经总线驱动 Orchestrator → 打印消息流与 token 计量。 */
export async function orchestrateTask(options: OrchestrateOptions): Promise<number> {
  const log = options.log ?? ((l: string) => console.log(l));
  const config = loadTeamConfig(options.configPath);

  const leader = options.leaderName ? selectAgent(config, options.leaderName) : pickLeader(config);
  const worker = options.workerName ? selectAgent(config, options.workerName) : pickWorker(config, leader);
  if (!worker) throw new Error('orchestrate 需要至少两个 agent（一个 leader、一个 worker）');

  const busPath = options.busPath ?? './.agent-orchestra/messages.jsonl';
  const bus = new JsonlMessageBus(busPath);
  const orch = new Orchestrator({
    bus,
    resolveAdapter: (c) => adapterFor(c.platform),
    review: options.review,
    cwd: options.cwd,
    onOutput: (agent: AgentConfig, out: AgentOutput) => {
      if (out.kind === 'assistant' && out.text) log(`[${agent.name}] ${out.text}`);
      else if (out.kind === 'result' && out.usage?.total != null) log(`[${agent.name}] (本轮 ${out.usage.total} tokens)`);
      else if (out.kind === 'error') log(`[${agent.name}][错误] ${out.message}`);
    },
  });

  log(`leader = ${leader.name} (${leader.platform})   worker = ${worker.name} (${worker.platform})`);
  log(`任务：${config.task.description}\n`);

  const { messages, usage, rounds } = await orch.runLeaderWorker({
    leader,
    worker,
    task: config.task.description,
    maxRounds: options.maxRounds,
  });

  log(`\n=== 消息流（共 ${messages.length} 条，${rounds} 轮，已持久化到 ${busPath}）===`);
  for (const m of messages) log(formatMessage(m));
  log(`\n=== token 累计：input=${usage.input ?? '-'} output=${usage.output ?? '-'} total=${usage.total ?? '-'} ===`);

  return messages.some((m) => m.type === 'report') ? 0 : 1;
}

function formatMessage(m: MessageEnvelope): string {
  const body = JSON.stringify(m.payload);
  const preview = body.length > 200 ? body.slice(0, 200) + '…' : body;
  return `· ${m.from} → ${m.to} [${m.type}] ${preview}`;
}
