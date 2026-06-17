import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { OpenCodeAdapter } from './opencode.js';
import type { AgentConfig, AgentOutput } from '@agent-orchestra/core';

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
  name: 'frontend',
  platform: 'opencode',
  role: '前端工程师',
  model: 'xiaomi-token-plan-cn/mimo-v2.5-pro',
};

async function collect(iter: AsyncIterable<AgentOutput>) {
  const out: AgentOutput[] = [];
  for await (const o of iter) out.push(o);
  return out;
}

describe('OpenCodeAdapter.buildArgv', () => {
  it('使用 run 子命令、json 格式并透传 model', () => {
    const adapter = new OpenCodeAdapter();
    const argv = adapter.buildArgv('做个登录页', baseConfig);
    expect(argv[0]).toBe('run');
    expect(argv).toContain('做个登录页');
    expect(argv).toEqual(expect.arrayContaining(['--format', 'json']));
    expect(argv).toEqual(expect.arrayContaining(['-m', 'xiaomi-token-plan-cn/mimo-v2.5-pro']));
  });

  it('未配置 model 时不带 -m', () => {
    const adapter = new OpenCodeAdapter();
    const argv = adapter.buildArgv('x', { name: 'a', platform: 'opencode', role: '' });
    expect(argv).not.toContain('-m');
  });
});

describe('OpenCodeAdapter 端到端（注入伪 spawn）', () => {
  it('start→send→stream 产出归一化输出', async () => {
    const lines = [
      JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }) + '\n',
      JSON.stringify({ type: 'text', part: { type: 'text', text: 'OK' } }) + '\n',
      JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } }) + '\n',
    ];
    const { spawnFn, calls } = makeFakeSpawn(lines);
    const adapter = new OpenCodeAdapter({ spawnFn, binPath: 'opencode' });

    const session = await adapter.start(baseConfig);
    await adapter.send(session, '做个登录页');
    const out = await collect(adapter.stream(session));

    expect(calls[0].cmd).toBe('opencode');
    expect(out.map((o) => o.kind)).toEqual(['system', 'assistant', 'result']);
    expect(out[2]).toMatchObject({ kind: 'result', text: 'OK', isError: false });
  });

  it('进程非零退出时追加 error 输出', async () => {
    const { spawnFn } = makeFakeSpawn([], { code: 1, stderr: '认证失败' });
    const adapter = new OpenCodeAdapter({ spawnFn });
    const session = await adapter.start(baseConfig);
    await adapter.send(session, 'x');
    const out = await collect(adapter.stream(session));
    expect(out.at(-1)).toMatchObject({ kind: 'error' });
    expect((out.at(-1) as any).message).toContain('认证失败');
  });

  it('stop 调用底层 kill', async () => {
    const { spawnFn, kill } = makeFakeSpawn([]);
    const adapter = new OpenCodeAdapter({ spawnFn });
    const session = await adapter.start(baseConfig);
    await adapter.send(session, 'x');
    await adapter.stop(session);
    expect(kill).toHaveBeenCalled();
  });
});
