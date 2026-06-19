import type { AgentAdapter, AgentConfig, AgentOutput } from './agent.js';

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
}

/**
 * 驱动一个 adapter 跑完一次任务并收敛输出：start → send → stream → stop。
 *
 * 统一 CLI 与 Orchestrator 的「让 agent 跑一轮并拿到最终文本」逻辑，
 * 通过 onOutput 回调把流式事件透出给调用方（用于实时打印）。
 */
export async function runAgent(
  adapter: AgentAdapter,
  config: AgentConfig,
  prompt: string,
  onOutput?: (output: AgentOutput) => void,
): Promise<RunAgentResult> {
  const session = await adapter.start(config);
  await adapter.send(session, prompt);

  let assistantText = '';
  let resultText = '';
  let errorMessage = '';
  let isError = false;
  try {
    for await (const out of adapter.stream(session)) {
      onOutput?.(out);
      switch (out.kind) {
        case 'assistant':
          assistantText += out.text;
          break;
        case 'result':
          resultText = out.text;
          if (out.isError) isError = true;
          break;
        case 'error':
          isError = true;
          errorMessage = out.message;
          break;
      }
    }
  } finally {
    await adapter.stop(session);
  }

  const answer = resultText || assistantText || errorMessage;
  return { assistantText, resultText, answer, isError, errorMessage: errorMessage || undefined };
}
