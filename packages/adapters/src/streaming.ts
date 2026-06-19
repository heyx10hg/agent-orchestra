import type { AgentOutput } from '@agent-orchestra/core';

/** 行解析器接口：把字节流增量解析为归一化输出，供各平台 adapter 复用 */
export interface LineParser {
  push(chunk: string): AgentOutput[];
  flush(): AgentOutput[];
}

/**
 * 把子进程的输出桥接成 AsyncIterable<AgentOutput>。
 *
 * 统一处理 stdout 解析、stderr 收集、spawn 错误与非零退出码，
 * 供 Claude Code / OpenCode 等基于子进程的 adapter 共用。
 */
export function pipeChildToQueue(child: any, parser: LineParser): AsyncIterable<AgentOutput> {
  const queue = new AsyncQueue<AgentOutput>();
  let stderr = '';

  child.stdout?.on('data', (d: Buffer | string) => {
    for (const o of parser.push(d.toString())) queue.push(o);
  });
  child.stderr?.on('data', (d: Buffer | string) => {
    stderr += d.toString();
  });
  child.on('error', (err: Error) => {
    queue.push({ kind: 'error', message: err?.message ?? String(err), raw: err });
    queue.end();
  });
  child.on('close', (code: number | null) => {
    for (const o of parser.flush()) queue.push(o);
    if (code && code !== 0) {
      const detail = stderr.trim() ? `: ${stderr.trim()}` : '';
      queue.push({ kind: 'error', message: `进程退出码 ${code}${detail}`, raw: { code, stderr } });
    }
    queue.end();
  });

  return queue;
}

/**
 * 包装输出流，嗅探其中的平台会话 id（result/system 事件的 sessionId）并回调，
 * 供 adapter 记录以实现多轮续接。
 */
export async function* captureSessionId(
  stream: AsyncIterable<AgentOutput>,
  onSessionId: (id: string) => void,
): AsyncIterable<AgentOutput> {
  for await (const out of stream) {
    if ((out.kind === 'result' || out.kind === 'system') && out.sessionId) {
      onSessionId(out.sessionId);
    }
    yield out;
  }
}

/** 单生产者/单消费者异步队列，把事件回调桥接成 AsyncIterable */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private resolvers: ((r: IteratorResult<T>) => void)[] = [];
  private ended = false;

  push(item: T): void {
    const resolve = this.resolvers.shift();
    if (resolve) resolve({ value: item, done: false });
    else this.items.push(item);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    let resolve;
    while ((resolve = this.resolvers.shift())) {
      resolve({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.ended) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.resolvers.push(resolve));
      },
    };
  }
}
