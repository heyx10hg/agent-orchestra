import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryMessageBus, JsonlMessageBus } from './message-bus.js';
import { createMessage } from './message.js';

function msg(from: string, to: string, type: 'task' | 'report') {
  return createMessage({ from, to, role: from, type, payload: { note: `${from}->${to}` } });
}

describe('InMemoryMessageBus', () => {
  it('按发布顺序返回消息', () => {
    const bus = new InMemoryMessageBus();
    bus.publish(msg('leader', 'worker', 'task'));
    bus.publish(msg('worker', 'leader', 'report'));
    expect(bus.list().map((m) => m.type)).toEqual(['task', 'report']);
  });

  it('按 to / type 过滤', () => {
    const bus = new InMemoryMessageBus();
    bus.publish(msg('leader', 'worker', 'task'));
    bus.publish(msg('worker', 'leader', 'report'));
    expect(bus.list({ to: 'worker' })).toHaveLength(1);
    expect(bus.list({ type: 'report' })[0].from).toBe('worker');
  });
});

describe('JsonlMessageBus', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('发布后可被新实例从同一文件读回（持久化）', () => {
    dir = mkdtempSync(join(tmpdir(), 'ao-bus-'));
    const path = join(dir, 'messages.jsonl');
    const bus = new JsonlMessageBus(path);
    bus.publish(msg('leader', 'worker', 'task'));
    bus.publish(msg('worker', 'leader', 'report'));

    const reopened = new JsonlMessageBus(path);
    const all = reopened.list();
    expect(all).toHaveLength(2);
    expect(all.map((m) => m.type)).toEqual(['task', 'report']);
  });

  it('文件不存在时 list 返回空数组', () => {
    dir = mkdtempSync(join(tmpdir(), 'ao-bus-'));
    const bus = new JsonlMessageBus(join(dir, 'nope.jsonl'));
    expect(bus.list()).toEqual([]);
  });

  it('支持过滤', () => {
    dir = mkdtempSync(join(tmpdir(), 'ao-bus-'));
    const bus = new JsonlMessageBus(join(dir, 'm.jsonl'));
    bus.publish(msg('leader', 'worker', 'task'));
    bus.publish(msg('worker', 'leader', 'report'));
    expect(bus.list({ from: 'worker' })).toHaveLength(1);
  });
});
