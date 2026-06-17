import { describe, it, expect } from 'vitest';
import { ClaudeCodeAdapter } from './claude-code.js';
import type { AgentOutput } from '@agent-orchestra/core';

/**
 * 真实端到端测试：实际调用本机 `claude` CLI，会消耗一次订阅额度。
 * 默认跳过，仅在 `RUN_E2E=1` 时运行：
 *   RUN_E2E=1 pnpm --filter @agent-orchestra/adapters test
 */
describe.skipIf(!process.env.RUN_E2E)('ClaudeCodeAdapter 真实端到端', () => {
  it('能跑通 spawn → 解析 → result 链路', async () => {
    const adapter = new ClaudeCodeAdapter();
    expect(await adapter.checkAvailable()).toBe(true);

    const session = await adapter.start({ name: 'e2e', platform: 'claude-code', role: '测试' });
    await adapter.send(session, '只回复两个字符：OK');

    const outputs: AgentOutput[] = [];
    for await (const o of adapter.stream(session)) outputs.push(o);
    await adapter.stop(session);

    const result = outputs.find((o) => o.kind === 'result');
    expect(result).toBeDefined();
    expect((result as { isError: boolean }).isError).toBe(false);
  }, 120_000);
});
