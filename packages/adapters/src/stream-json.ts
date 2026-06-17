import type { AgentOutput } from '@agent-orchestra/core';

/**
 * 增量式 NDJSON 解析器：把 `claude --output-format stream-json` 的字节流
 * 归一化为 AgentOutput。
 *
 * - 维护跨 chunk 的半行缓冲；
 * - 忽略空行；
 * - 单行 JSON 解析失败时降级为 error 输出，而非抛出，避免一行坏数据中断整条流。
 */
export class StreamJsonParser {
  private buffer = '';

  /** 喂入一段数据，返回其中完整行解析出的输出 */
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

  /** 流结束时调用，处理结尾无换行的残余行 */
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
      return { kind: 'error', message: `无法解析的流式输出行: ${trimmed}`, raw: trimmed };
    }
    return normalizeEvent(event);
  }
}

/** 把单个 stream-json 事件对象归一化为 AgentOutput */
export function normalizeEvent(event: any): AgentOutput {
  switch (event?.type) {
    case 'assistant': {
      const blocks = event.message?.content;
      const text = Array.isArray(blocks)
        ? blocks
            .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
            .map((b: any) => b.text)
            .join('')
        : '';
      return { kind: 'assistant', text, raw: event };
    }
    case 'result':
      return {
        kind: 'result',
        text: typeof event.result === 'string' ? event.result : '',
        isError: event.is_error === true || event.subtype === 'error',
        raw: event,
      };
    case 'system':
      return { kind: 'system', subtype: String(event.subtype ?? 'unknown'), raw: event };
    default:
      return { kind: 'system', subtype: String(event?.type ?? 'unknown'), raw: event };
  }
}
