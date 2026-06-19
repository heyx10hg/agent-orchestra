import { ClaudeCodeAdapter, OpenCodeAdapter } from '@agent-orchestra/adapters';
import { runAgent, type AgentAdapter, type AgentConfig, type AgentOutput } from '@agent-orchestra/core';
import { loadTeamConfig, selectAgent, type TeamConfig } from './config.js';

/** 按平台标识选择 adapter，这是跨平台多 agent 协同的接入点 */
export function adapterFor(platform: string): AgentAdapter {
  switch (platform) {
    case 'claude-code':
      return new ClaudeCodeAdapter();
    case 'opencode':
      return new OpenCodeAdapter();
    default:
      throw new Error(`暂不支持的平台：${platform}（已支持：claude-code, opencode）`);
  }
}

export interface TaskSpec {
  description: string;
  requirements?: string[];
}

/** 把角色与任务合成为发给 agent 的提示词 */
export function buildPrompt(agent: AgentConfig, task: TaskSpec): string {
  const lines = [`你的角色：${agent.role}`, '', `任务：${task.description}`];
  if (task.requirements?.length) {
    lines.push('', '要求：', ...task.requirements.map((r) => `- ${r}`));
  }
  return lines.join('\n');
}

export interface RunOptions {
  configPath: string;
  agentName?: string;
  dryRun?: boolean;
  /** 可注入 adapter，便于测试；默认 ClaudeCodeAdapter */
  adapter?: AgentAdapter;
  /** 输出函数，默认 console.log */
  log?: (line: string) => void;
}

/** 执行单 agent 任务：加载配置 → 选 agent → 经 adapter 运行 → 打印输出。返回退出码。 */
export async function runTask(options: RunOptions): Promise<number> {
  const log = options.log ?? ((l: string) => console.log(l));
  const config: TeamConfig = loadTeamConfig(options.configPath);
  const agent = selectAgent(config, options.agentName);
  const prompt = buildPrompt(agent, config.task);

  if (options.dryRun) {
    log(`[dry-run] agent: ${agent.name} (${agent.platform})`);
    if (agent.platform === 'claude-code') {
      const cc = new ClaudeCodeAdapter();
      log(`[dry-run] argv: claude ${cc.buildArgv(prompt, agent).join(' ')}`);
      const env = cc.buildEnv(agent);
      log(`[dry-run] ANTHROPIC_BASE_URL=${env.ANTHROPIC_BASE_URL ?? '(继承环境)'}`);
      log(`[dry-run] ANTHROPIC_MODEL=${env.ANTHROPIC_MODEL ?? '(继承环境)'}`);
    } else if (agent.platform === 'opencode') {
      const oc = new OpenCodeAdapter();
      log(`[dry-run] argv: opencode ${oc.buildArgv(prompt, agent).join(' ')}`);
    } else {
      log(`[dry-run] 暂不支持的平台：${agent.platform}`);
    }
    return 0;
  }

  const adapter = options.adapter ?? adapterFor(agent.platform);
  const result = await runAgent(adapter, agent, prompt, (out) => printOutput(out, log));
  if (result.resultText) log(`\n[结果] ${result.resultText}`);
  return result.isError ? 1 : 0;
}

/** 把单条归一化输出友好打印到日志 */
function printOutput(out: AgentOutput, log: (line: string) => void): void {
  if (out.kind === 'assistant' && out.text) log(out.text);
  else if (out.kind === 'error') log(`\n[错误] ${out.message}`);
}
