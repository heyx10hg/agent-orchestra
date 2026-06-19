import { appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { serialize, deserialize, type MessageEnvelope, type MessageType } from './message.js';

export interface MessageFilter {
  from?: string;
  to?: string;
  type?: MessageType;
}

/** 本地消息总线：agent 间异步通信的中介，所有消息流经此处以便观测与回放 */
export interface MessageBus {
  publish(message: MessageEnvelope): void;
  list(filter?: MessageFilter): MessageEnvelope[];
}

function matches(message: MessageEnvelope, filter?: MessageFilter): boolean {
  if (!filter) return true;
  if (filter.from && message.from !== filter.from) return false;
  if (filter.to && message.to !== filter.to) return false;
  if (filter.type && message.type !== filter.type) return false;
  return true;
}

/** 内存实现：适合测试与单进程编排 */
export class InMemoryMessageBus implements MessageBus {
  private readonly messages: MessageEnvelope[] = [];

  publish(message: MessageEnvelope): void {
    this.messages.push(message);
  }

  list(filter?: MessageFilter): MessageEnvelope[] {
    return this.messages.filter((m) => matches(m, filter));
  }
}

/**
 * JSONL 追加日志实现：每条消息一行，天然支持持久化与跨进程回放，
 * 对应架构文档中「SQLite 或 JSONL 追加日志」的轻量方案。
 */
export class JsonlMessageBus implements MessageBus {
  constructor(private readonly filePath: string) {}

  publish(message: MessageEnvelope): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, serialize(message) + '\n', 'utf8');
  }

  list(filter?: MessageFilter): MessageEnvelope[] {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch {
      return [];
    }
    return raw
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => deserialize(line))
      .filter((m) => matches(m, filter));
  }
}
