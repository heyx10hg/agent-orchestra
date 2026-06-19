import { describe, it, expect } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import { InMemoryMessageBus } from './message-bus.js';
import type { AgentAdapter, AgentConfig, AgentOutput, AgentSession } from './agent.js';

/** 脚本化伪 adapter：记录收到的 prompt，按平台返回预设答案 */
class ScriptedAdapter implements AgentAdapter {
  sent: string[] = [];
  constructor(private answer: string) {}
  async start(config: AgentConfig): Promise<AgentSession> {
    return { id: Math.random().toString(36), config };
  }
  async send(_s: AgentSession, message: string): Promise<void> {
    this.sent.push(message);
  }
  async *stream(): AsyncIterable<AgentOutput> {
    yield { kind: 'result', text: this.answer, isError: false, raw: {} };
  }
  async stop(): Promise<void> {}
}

const leader: AgentConfig = { name: 'leader', platform: 'claude-code', role: '技术负责人' };
const worker: AgentConfig = { name: 'frontend', platform: 'opencode', role: '前端工程师' };

describe('Orchestrator.runLeaderWorker', () => {
  it('leader 拆解 → worker 执行，消息流经总线', async () => {
    const leaderAdapter = new ScriptedAdapter('实现登录接口 POST /login');
    const workerAdapter = new ScriptedAdapter('已实现 POST /login，含单测');
    const adapters: Record<string, AgentAdapter> = {
      'claude-code': leaderAdapter,
      opencode: workerAdapter,
    };
    const bus = new InMemoryMessageBus();
    const orch = new Orchestrator({ bus, resolveAdapter: (c) => adapters[c.platform] });

    const messages = await orch.runLeaderWorker({ leader, worker, task: '做一个登录功能' });

    // worker 收到的 prompt 里应包含 leader 拆解出的指令
    expect(workerAdapter.sent[0]).toContain('实现登录接口 POST /login');

    // 总线上应有 task(leader→worker) 与 report(worker→leader)
    const task = bus.list({ type: 'task' });
    const report = bus.list({ type: 'report' });
    expect(task).toHaveLength(1);
    expect(task[0]).toMatchObject({ from: 'leader', to: 'frontend' });
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ from: 'frontend', to: 'leader' });

    // 返回完整消息记录
    expect(messages.map((m) => m.type)).toEqual(['task', 'report']);
  });

  it('开启 review 时追加 leader 的 decision 消息', async () => {
    const adapters: Record<string, AgentAdapter> = {
      'claude-code': new ScriptedAdapter('指令'),
      opencode: new ScriptedAdapter('汇报'),
    };
    const bus = new InMemoryMessageBus();
    const orch = new Orchestrator({ bus, resolveAdapter: (c) => adapters[c.platform], review: true });

    await orch.runLeaderWorker({ leader, worker, task: 't' });

    expect(bus.list({ type: 'decision' })).toHaveLength(1);
    expect(bus.list({ type: 'decision' })[0]).toMatchObject({ from: 'leader', to: 'frontend' });
  });
});
