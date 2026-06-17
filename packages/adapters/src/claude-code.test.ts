import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ClaudeCodeAdapter } from './claude-code.js';
import type { AgentConfig, AgentOutput } from '@agent-orchestra/core';

/** 构造一个模拟 child_process 的 spawn，按预设行发 stdout 后 close */
function makeFakeSpawn(lines: string[], opts: { code?: number; stderr?: string } = {}) {
  const kill = vi.fn();
  const calls: { cmd: string; args: string[]; options: any }[] = [];
  const spawnFn = (cmd: string, args: string[], options: any) => {
    calls.push({ cmd, args, options });
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = kill;
    setTimeout(() => {
      for (const line of lines) child.stdout.emit('data', Buffer.from(line));
      if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr));
      child.emit('close', opts.code ?? 0);
    }, 0);
    return child;
  };
  return { spawnFn, kill, calls };
}

const baseConfig: AgentConfig = {
  name: 'leader',
  platform: 'claude-code',
  role: '技术负责人',
};

async function collect(iter: AsyncIterable<AgentOutput>) {
  const out: AgentOutput[] = [];
  for await (const o of iter) out.push(o);
  return out;
}

describe('ClaudeCodeAdapter.buildArgv', () => {
  it('包含 print、stream-json 与 verbose', () => {
    const adapter = new ClaudeCodeAdapter();
    const argv = adapter.buildArgv('做个登录页', baseConfig);
    expect(argv).toContain('-p');
    expect(argv).toContain('做个登录页');
    expect(argv).toEqual(expect.arrayContaining(['--output-format', 'stream-json', '--verbose']));
  });

  it('配置了 permissionMode 时透传', () => {
    const adapter = new ClaudeCodeAdapter();
    const argv = adapter.buildArgv('x', { ...baseConfig, permissionMode: 'plan' });
    expect(argv).toEqual(expect.arrayContaining(['--permission-mode', 'plan']));
  });

  it('provider.model 存在时透传 --model', () => {
    const adapter = new ClaudeCodeAdapter();
    const argv = adapter.buildArgv('x', { ...baseConfig, provider: { model: 'mimo-v2.5-pro' } });
    expect(argv).toEqual(expect.arrayContaining(['--model', 'mimo-v2.5-pro']));
  });
});

describe('ClaudeCodeAdapter.buildEnv', () => {
  it('无 provider 时不注入 ANTHROPIC_* 覆盖', () => {
    const adapter = new ClaudeCodeAdapter();
    const env = adapter.buildEnv(baseConfig);
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.ANTHROPIC_MODEL).toBeUndefined();
  });

  it('有 provider 时映射到 ANTHROPIC_* 环境变量', () => {
    const adapter = new ClaudeCodeAdapter();
    const env = adapter.buildEnv({
      ...baseConfig,
      provider: { baseUrl: 'https://example.com', authToken: 'tok', model: 'mimo' },
    });
    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.com');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok');
    expect(env.ANTHROPIC_MODEL).toBe('mimo');
  });

  it('注入 authToken 时清除残留的 ANTHROPIC_API_KEY', () => {
    const adapter = new ClaudeCodeAdapter();
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'stale-key';
    try {
      const env = adapter.buildEnv({ ...baseConfig, provider: { authToken: 'tok' } });
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok');
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});

describe('ClaudeCodeAdapter 端到端（注入伪 spawn）', () => {
  it('start→send→stream 产出归一化输出', async () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init' }) + '\n',
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'OK' }] } }) + '\n',
      JSON.stringify({ type: 'result', subtype: 'success', result: '完成', is_error: false }) + '\n',
    ];
    const { spawnFn, calls } = makeFakeSpawn(lines);
    const adapter = new ClaudeCodeAdapter({ spawnFn, binPath: 'claude' });

    const session = await adapter.start(baseConfig);
    await adapter.send(session, '做个登录页');
    const out = await collect(adapter.stream(session));

    expect(calls[0].cmd).toBe('claude');
    expect(calls[0].args).toContain('做个登录页');
    expect(out.map((o) => o.kind)).toEqual(['system', 'assistant', 'result']);
    expect(out[2]).toMatchObject({ kind: 'result', text: '完成', isError: false });
  });

  it('进程非零退出时追加 error 输出', async () => {
    const { spawnFn } = makeFakeSpawn([], { code: 1, stderr: '未登录' });
    const adapter = new ClaudeCodeAdapter({ spawnFn });
    const session = await adapter.start(baseConfig);
    await adapter.send(session, 'x');
    const out = await collect(adapter.stream(session));
    expect(out.at(-1)).toMatchObject({ kind: 'error' });
    expect((out.at(-1) as any).message).toContain('未登录');
  });

  it('stop 调用底层 kill', async () => {
    const { spawnFn, kill } = makeFakeSpawn([]);
    const adapter = new ClaudeCodeAdapter({ spawnFn });
    const session = await adapter.start(baseConfig);
    await adapter.send(session, 'x');
    await adapter.stop(session);
    expect(kill).toHaveBeenCalled();
  });
});
