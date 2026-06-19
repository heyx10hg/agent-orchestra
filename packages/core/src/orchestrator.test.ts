import { describe, it, expect } from 'vitest';
import { Orchestrator, looksLikeQuestion } from './orchestrator.js';
import { InMemoryMessageBus } from './message-bus.js';
import type { AgentAdapter, AgentConfig, AgentOutput, AgentSession } from './agent.js';

/** 脚本化伪 adapter：每次 stream 返回队列里的下一条答案（队尾值重复） */
class ScriptedAdapter implements AgentAdapter {
  sent: string[] = [];
  private i = 0;
  constructor(private answers: string[], private usage?: { total: number }) {}
  async start(config: AgentConfig): Promise<AgentSession> {
    return { id: Math.random().toString(36), config };
  }
  async send(_s: AgentSession, message: string): Promise<void> {
    this.sent.push(message);
  }
  async *stream(): AsyncIterable<AgentOutput> {
    const text = this.answers[Math.min(this.i, this.answers.length - 1)];
    this.i++;
    yield { kind: 'result', text, isError: false, usage: this.usage, raw: {} };
  }
  async stop(): Promise<void> {}
}

const leader: AgentConfig = { name: 'leader', platform: 'claude-code', role: '技术负责人' };
const worker: AgentConfig = { name: 'frontend', platform: 'opencode', role: '前端工程师' };

describe('looksLikeQuestion', () => {
  it('含问号视为提问', () => {
    expect(looksLikeQuestion('用哪个数据库？')).toBe(true);
    expect(looksLikeQuestion('已完成。')).toBe(false);
  });
});

describe('Orchestrator.runLeaderWorker', () => {
  it('leader 拆解 → worker 执行，消息流经总线，并汇总 token', async () => {
    const adapters: Record<string, AgentAdapter> = {
      'claude-code': new ScriptedAdapter(['实现登录接口 POST /login'], { total: 100 }),
      opencode: new ScriptedAdapter(['已实现 POST /login，含单测'], { total: 50 }),
    };
    const bus = new InMemoryMessageBus();
    const orch = new Orchestrator({ bus, resolveAdapter: (c) => adapters[c.platform] });

    const result = await orch.runLeaderWorker({ leader, worker, task: '做一个登录功能' });

    const workerAdapter = adapters.opencode as ScriptedAdapter;
    expect(workerAdapter.sent[0]).toContain('实现登录接口 POST /login');

    expect(bus.list({ type: 'task' })).toHaveLength(1);
    expect(bus.list({ type: 'task' })[0]).toMatchObject({ from: 'leader', to: 'frontend' });
    expect(bus.list({ type: 'report' })).toHaveLength(1);
    expect(result.messages.map((m) => m.type)).toEqual(['task', 'report']);
    expect(result.rounds).toBe(1);
    expect(result.usage.total).toBe(150); // 拆解 100 + worker 50
  });

  it('worker 反问时与 leader 多轮往返，直至产出汇报', async () => {
    const adapters: Record<string, AgentAdapter> = {
      // 第一次=拆解指令；第二次=回答 worker 的疑问
      'claude-code': new ScriptedAdapter(['实现登录', '用 SQLite 存用户']),
      // 第一次=反问；第二次=完成汇报
      opencode: new ScriptedAdapter(['用哪个数据库？', '已完成，使用 SQLite']),
    };
    const bus = new InMemoryMessageBus();
    const orch = new Orchestrator({ bus, resolveAdapter: (c) => adapters[c.platform] });

    const result = await orch.runLeaderWorker({ leader, worker, task: 't', maxRounds: 3 });

    expect(bus.list({ type: 'question' })).toHaveLength(1);
    expect(bus.list({ type: 'question' })[0]).toMatchObject({ from: 'frontend', to: 'leader' });
    expect(bus.list({ type: 'report' })).toHaveLength(1);
    expect(result.rounds).toBe(2);
    // task(拆解) + question + task(leader 回答) + report
    expect(result.messages.map((m) => m.type)).toEqual(['task', 'question', 'task', 'report']);
  });

  it('达到轮数上限时强制收尾为 report（不再追问）', async () => {
    const adapters: Record<string, AgentAdapter> = {
      'claude-code': new ScriptedAdapter(['指令', '回答']),
      opencode: new ScriptedAdapter(['还是有疑问？']), // 一直反问
    };
    const bus = new InMemoryMessageBus();
    const orch = new Orchestrator({ bus, resolveAdapter: (c) => adapters[c.platform] });

    const result = await orch.runLeaderWorker({ leader, worker, task: 't', maxRounds: 2 });
    expect(result.rounds).toBe(2);
    expect(bus.list({ type: 'report' })).toHaveLength(1);
  });

  it('开启 review 时追加 leader 的 decision 消息', async () => {
    const adapters: Record<string, AgentAdapter> = {
      'claude-code': new ScriptedAdapter(['指令', '评审通过']),
      opencode: new ScriptedAdapter(['汇报']),
    };
    const bus = new InMemoryMessageBus();
    const orch = new Orchestrator({ bus, resolveAdapter: (c) => adapters[c.platform], review: true });

    await orch.runLeaderWorker({ leader, worker, task: 't' });

    expect(bus.list({ type: 'decision' })).toHaveLength(1);
    expect(bus.list({ type: 'decision' })[0]).toMatchObject({ from: 'leader', to: 'frontend' });
  });
});
