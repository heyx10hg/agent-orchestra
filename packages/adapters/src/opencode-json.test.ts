import { describe, it, expect } from 'vitest';
import { OpenCodeJsonParser } from './opencode-json.js';

function parseAll(chunks: string[]) {
  const parser = new OpenCodeJsonParser();
  const out = chunks.flatMap((c) => parser.push(c));
  return [...out, ...parser.flush()];
}

// 取自真实 `opencode run ... --format json` 的事件形状
const stepStart = JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }) + '\n';
const textEvent = JSON.stringify({ type: 'text', part: { type: 'text', text: '好的' } }) + '\n';
const stepFinish =
  JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop', tokens: { total: 9584 }, cost: 0 } }) + '\n';

describe('OpenCodeJsonParser', () => {
  it('text 事件归一化为 assistant 输出', () => {
    const out = parseAll([textEvent]);
    expect(out).toContainEqual(expect.objectContaining({ kind: 'assistant', text: '好的' }));
  });

  it('step_finish(reason=stop) 归一化为非错误 result，并带累计文本', () => {
    const out = parseAll([textEvent, stepFinish]);
    const result = out.find((o) => o.kind === 'result');
    expect(result).toMatchObject({ kind: 'result', text: '好的', isError: false });
  });

  it('step_start 归一化为 system 事件', () => {
    const out = parseAll([stepStart]);
    expect(out[0]).toMatchObject({ kind: 'system', subtype: 'step_start' });
  });

  it('完整一轮：system → assistant → result 顺序', () => {
    const out = parseAll([stepStart, textEvent, stepFinish]);
    expect(out.map((o) => o.kind)).toEqual(['system', 'assistant', 'result']);
  });

  it('reason=error 的 step_finish 标记为错误', () => {
    const errFinish = JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'error' } }) + '\n';
    const out = parseAll([errFinish]);
    expect(out.find((o) => o.kind === 'result')).toMatchObject({ isError: true });
  });

  it('顶层 error 事件归一化为 error 输出', () => {
    const errEvent = JSON.stringify({ type: 'error', error: { message: '认证失败' } }) + '\n';
    const out = parseAll([errEvent]);
    expect(out[0]).toMatchObject({ kind: 'error' });
    expect((out[0] as { message: string }).message).toContain('认证失败');
  });

  it('坏行降级为 error 而非抛错', () => {
    const out = parseAll(['{ 坏 json\n']);
    expect(out[0]).toMatchObject({ kind: 'error' });
  });

  it('跨 chunk 半行正确拼接', () => {
    const half1 = textEvent.slice(0, 12);
    const half2 = textEvent.slice(12);
    const out = parseAll([half1, half2]);
    expect(out).toContainEqual(expect.objectContaining({ kind: 'assistant', text: '好的' }));
  });
});
