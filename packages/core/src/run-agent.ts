import type { AgentAdapter, AgentConfig, AgentOutput, AgentSession, TokenUsage } from './agent.js';

export interface RunAgentResult {
  /** 拼接的全部 assistant 文本块 */
  assistantText: string;
  /** result 事件的文本（部分平台为最终答案） */
  resultText: string;
  /** 规范化的最终答案：优先 result，回退到 assistant 文本，再回退到错误信息 */
  answer: string;
  /** 是否出错（result.isError 或出现 error 事件） */
  isError: boolean;
  /** 错误信息（若出现 error 事件） */
  errorMessage?: string;
  /** 本轮 token 用量（累加各 result 事件） */
  usage: TokenUsage;
  /** 平台会话 id（用于多轮续接） */
  sessionId?: string;
}

function addUsage(acc: TokenUsage, u?: TokenUsage): void {
  if (!u) return;
  if (u.input != null) acc.input = (acc.input ?? 0) + u.input;
  if (u.output != null) acc.output = (acc.output ?? 0) + u.output;
  if (u.total != null) acc.total = (acc.total ?? 0) + u.total;
}

/**
 * 在一个已存在的会话上跑完一轮：send → stream → 收敛。不负责 start/stop，
 * 因此可在同一会话上多次调用（配合 adapter 的会话续接实现低成本多轮）。
 */
export async function collectRun(
  adapter: AgentAdapter,
  session: AgentSession,
  prompt: string,
  onOutput?: (output: AgentOutput) => void,
): Promise<RunAgentResult> {
  await adapter.send(session, prompt);

  let assistantText = '';
  let resultText = '';
  let errorMessage = '';
  let isError = false;
  let sessionId: string | undefined;
  const usage: TokenUsage = {};

  for await (const out of adapter.stream(session)) {
    onOutput?.(out);
    switch (out.kind) {
      case 'assistant':
        assistantText += out.text;
        break;
      case 'result':
        resultText = out.text;
        if (out.isError) isError = true;
        addUsage(usage, out.usage);
        if (out.sessionId) sessionId = out.sessionId;
        break;
      case 'system':
        if (out.sessionId) sessionId = out.sessionId;
        break;
      case 'error':
        isError = true;
        errorMessage = out.message;
        break;
    }
  }

  const answer = resultText || assistantText || errorMessage;
  return { assistantText, resultText, answer, isError, errorMessage: errorMessage || undefined, usage, sessionId };
}

/**
 * 驱动一个 adapter 跑完一次性任务：start → send → stream → stop。
 * 单轮场景使用；多轮请用 start + 多次 collectRun + stop。
 */
export async function runAgent(
  adapter: AgentAdapter,
  config: AgentConfig,
  prompt: string,
  onOutput?: (output: AgentOutput) => void,
): Promise<RunAgentResult> {
  const session = await adapter.start(config);
  try {
    return await collectRun(adapter, session, prompt, onOutput);
  } finally {
    await adapter.stop(session);
  }
}
