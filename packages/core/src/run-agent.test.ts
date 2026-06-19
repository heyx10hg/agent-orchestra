import { describe, it, expect } from 'vitest';
import { runAgent } from './run-agent.js';
import type { AgentAdapter, AgentConfig, AgentOutput, AgentSession } from './agent.js';

class FakeAdapter implements AgentAdapter {
  sent: string[] = [];
  stopped = false;
  constructor(private outputs: AgentOutput[]) {}
  async start(config: AgentConfig): Promise<AgentSession> {
    return { id: 's1', config };
  }
  async send(_session: AgentSession, message: string): Promise<void> {
    this.sent.push(message);
  }
  async *stream(): AsyncIterable<AgentOutput> {
    for (const o of this.outputs) yield o;
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }
}

const config: AgentConfig = { name: 'a', platform: 'fake', role: 'r' };

describe('runAgent', () => {
  it('拼接 assistant 文本、捕获 result，并在结束后 stop', async () => {
    const adapter = new FakeAdapter([
      { kind: 'system', subtype: 'init', raw: {} },
      { kind: 'assistant', text: '前半', raw: {} },
      { kind: 'assistant', text: '后半', raw: {} },
      { kind: 'result', text: '完成', isError: false, raw: {} },
    ]);
    const seen: string[] = [];
    const res = await runAgent(adapter, config, '干活', (o) => seen.push(o.kind));

    expect(adapter.sent).toEqual(['干活']);
    expect(res.assistantText).toBe('前半后半');
    expect(res.resultText).toBe('完成');
    expect(res.isError).toBe(false);
    expect(res.answer).toBe('完成');
    expect(adapter.stopped).toBe(true);
    expect(seen).toEqual(['system', 'assistant', 'assistant', 'result']);
  });

  it('error 输出使 isError 为真，answer 回退到 assistant 文本', async () => {
    const adapter = new FakeAdapter([
      { kind: 'assistant', text: '部分结果', raw: {} },
      { kind: 'error', message: '认证失败', raw: {} },
    ]);
    const res = await runAgent(adapter, config, 'x');
    expect(res.isError).toBe(true);
    expect(res.answer).toBe('部分结果');
  });

  it('无 result 时 answer 取 assistant 文本', async () => {
    const adapter = new FakeAdapter([{ kind: 'assistant', text: '只有助手文本', raw: {} }]);
    const res = await runAgent(adapter, config, 'x');
    expect(res.answer).toBe('只有助手文本');
  });
});
