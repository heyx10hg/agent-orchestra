import type { AgentOutput } from '@agent-orchestra/core';
import type { LineParser } from './streaming.js';

/**
 * 增量式解析器：把 `opencode run --format json` 的 NDJSON 事件流归一化为 AgentOutput。
 *
 * 事件形状（取自真实输出）：
 * - `{ type: 'step_start', part: {...} }`
 * - `{ type: 'text', part: { text } }`        → assistant 文本块
 * - `{ type: 'step_finish', part: { reason } }` → 一步结束，归一化为 result
 * - `{ type: 'error', error: { message } }`
 *
 * OpenCode 的最终回答由多个 text 块拼成、step_finish 本身不含文本，
 * 因此解析器累积文本并在 step_finish 时作为 result.text 输出，随后清空累积。
 */
export class OpenCodeJsonParser implements LineParser {
  private buffer = '';
  private accumulatedText = '';

  push(chunk: string): AgentOutput[] {
    this.buffer += chunk;
    const outputs: AgentOutput[] = [];
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      const out = this.parseLine(line);
      if (out) outputs.push(out);
    }
    return outputs;
  }

  flush(): AgentOutput[] {
    const rest = this.buffer;
    this.buffer = '';
    const out = this.parseLine(rest);
    return out ? [out] : [];
  }

  private parseLine(line: string): AgentOutput | null {
    const trimmed = line.trim();
    if (trimmed === '') return null;

    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return { kind: 'error', message: `无法解析的 OpenCode 输出行: ${trimmed}`, raw: trimmed };
    }

    switch (event?.type) {
      case 'text': {
        const text = typeof event.part?.text === 'string' ? event.part.text : '';
        this.accumulatedText += text;
        return { kind: 'assistant', text, raw: event };
      }
      case 'step_finish': {
        const reason = event.part?.reason;
        const text = this.accumulatedText;
        this.accumulatedText = '';
        const t = event.part?.tokens;
        const usage =
          t && typeof t === 'object'
            ? { input: t.input, output: t.output, total: t.total }
            : undefined;
        return {
          kind: 'result',
          text,
          isError: reason === 'error',
          usage,
          sessionId: typeof event.sessionID === 'string' ? event.sessionID : undefined,
          raw: event,
        };
      }
      case 'error': {
        const message = event.error?.message ?? event.message ?? 'OpenCode 报错';
        return { kind: 'error', message: String(message), raw: event };
      }
      default:
        return {
          kind: 'system',
          subtype: String(event?.type ?? 'unknown'),
          sessionId: typeof event.sessionID === 'string' ? event.sessionID : undefined,
          raw: event,
        };
    }
  }
}
