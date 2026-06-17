import { z } from 'zod';

/** 消息类型：任务分配 / 进度汇报 / 评审请求 / 提问 / 决策 */
export const messageTypeSchema = z.enum(['task', 'report', 'review', 'question', 'decision']);
export type MessageType = z.infer<typeof messageTypeSchema>;

/** agent 间通信的消息信封，设计向 A2A/ACP 协议靠拢 */
export const messageEnvelopeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  role: z.string(),
  type: messageTypeSchema,
  payload: z.unknown(),
  ts: z.number().int().nonnegative(),
});

export type MessageEnvelope = z.infer<typeof messageEnvelopeSchema>;

/** 创建消息时由调用方提供的字段（id 与 ts 自动生成） */
export type NewMessage = Omit<MessageEnvelope, 'id' | 'ts'>;

/** 创建一条新消息，自动填充唯一 id 与时间戳 */
export function createMessage(input: NewMessage): MessageEnvelope {
  return {
    ...input,
    id: crypto.randomUUID(),
    ts: Date.now(),
  };
}

/** 校验任意输入是否为合法 envelope，不合法则抛出 ZodError */
export function validateEnvelope(input: unknown): MessageEnvelope {
  return messageEnvelopeSchema.parse(input);
}

/** 序列化为 JSON 字符串（适配 JSONL 消息总线） */
export function serialize(message: MessageEnvelope): string {
  return JSON.stringify(message);
}

/** 从 JSON 字符串反序列化并校验结构 */
export function deserialize(raw: string): MessageEnvelope {
  return validateEnvelope(JSON.parse(raw));
}
