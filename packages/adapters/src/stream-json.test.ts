import { describe, it, expect } from 'vitest';
import { StreamJsonParser } from './stream-json.js';

function parseAll(chunks: string[]) {
  const parser = new StreamJsonParser();
  const out = chunks.flatMap((c) => parser.push(c));
  return [...out, ...parser.flush()];
}

describe('StreamJsonParser', () => {
  it('解析 system/init 事件', () => {
    const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc' }) + '\n';
    const out = parseAll([line]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'system', subtype: 'init' });
  });

  it('从 assistant 事件提取文本', () => {
    const line =
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '你好' }, { type: 'text', text: '世界' }] },
      }) + '\n';
    const out = parseAll([line]);
    expect(out).toEqual([{ kind: 'assistant', text: '你好世界', raw: expect.anything() }]);
  });

  it('解析 result 事件并识别错误标志', () => {
    const ok = JSON.stringify({ type: 'result', subtype: 'success', result: '完成', is_error: false }) + '\n';
    const err = JSON.stringify({ type: 'result', subtype: 'error', result: '失败', is_error: true }) + '\n';
    const out = parseAll([ok, err]);
    expect(out[0]).toMatchObject({ kind: 'result', text: '完成', isError: false });
    expect(out[1]).toMatchObject({ kind: 'result', text: '失败', isError: true });
  });

  it('跨 chunk 半行能正确拼接', () => {
    const obj = JSON.stringify({ type: 'system', subtype: 'init' });
    const half1 = obj.slice(0, 10);
    const half2 = obj.slice(10) + '\n';
    const out = parseAll([half1, half2]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'system', subtype: 'init' });
  });

  it('忽略空行', () => {
    const line = JSON.stringify({ type: 'system', subtype: 'init' });
    const out = parseAll(['\n\n' + line + '\n\n']);
    expect(out).toHaveLength(1);
  });

  it('坏行降级为 error 输出而非抛错', () => {
    const out = parseAll(['{ 不是合法 json\n']);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'error' });
  });

  it('flush 处理结尾无换行的最后一行', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', is_error: false });
    const out = parseAll([line]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'result', text: 'ok' });
  });
});
