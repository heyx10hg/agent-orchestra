import { describe, it, expect } from 'vitest';
import {
  createMessage,
  validateEnvelope,
  serialize,
  deserialize,
  type MessageEnvelope,
} from './message.js';

describe('createMessage', () => {
  it('填充 id 与 ts，并保留传入字段', () => {
    const msg = createMessage({
      from: 'leader',
      to: 'frontend',
      role: '技术负责人',
      type: 'task',
      payload: { description: '实现登录页' },
    });

    expect(msg.id).toMatch(/[0-9a-f-]{36}/);
    expect(typeof msg.ts).toBe('number');
    expect(msg.ts).toBeLessThanOrEqual(Date.now());
    expect(msg.from).toBe('leader');
    expect(msg.to).toBe('frontend');
    expect(msg.type).toBe('task');
    expect(msg.payload).toEqual({ description: '实现登录页' });
  });

  it('每条消息的 id 唯一', () => {
    const base = { from: 'a', to: 'b', role: 'r', type: 'report' as const, payload: null };
    expect(createMessage(base).id).not.toBe(createMessage(base).id);
  });
});

describe('validateEnvelope', () => {
  const valid: MessageEnvelope = {
    id: '11111111-1111-1111-1111-111111111111',
    from: 'leader',
    to: 'backend',
    role: '技术负责人',
    type: 'review',
    payload: { pr: 12 },
    ts: 1700000000000,
  };

  it('接受合法 envelope', () => {
    expect(() => validateEnvelope(valid)).not.toThrow();
    expect(validateEnvelope(valid)).toEqual(valid);
  });

  it('拒绝缺少 to 字段', () => {
    const { to, ...rest } = valid;
    expect(() => validateEnvelope(rest)).toThrow();
  });

  it('拒绝非法 type', () => {
    expect(() => validateEnvelope({ ...valid, type: 'broadcast' })).toThrow();
  });

  it('拒绝 ts 非数字', () => {
    expect(() => validateEnvelope({ ...valid, ts: 'now' })).toThrow();
  });
});

describe('serialize / deserialize', () => {
  it('往返后保持相等', () => {
    const msg = createMessage({
      from: 'frontend',
      to: 'leader',
      role: '前端工程师',
      type: 'question',
      payload: { q: '接口字段命名？' },
    });

    const restored = deserialize(serialize(msg));
    expect(restored).toEqual(msg);
  });

  it('deserialize 对非法 JSON 抛错', () => {
    expect(() => deserialize('{ not json')).toThrow();
  });

  it('deserialize 对结构不合法的消息抛错', () => {
    expect(() => deserialize(JSON.stringify({ from: 'a' }))).toThrow();
  });
});
