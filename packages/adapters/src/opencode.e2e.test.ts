import { describe, it, expect } from 'vitest';
import { OpenCodeAdapter } from './opencode.js';
import type { AgentOutput } from '@agent-orchestra/core';

/**
 * 真实端到端测试：实际调用本机 `opencode`，走其已配置的 MiMo 订阅（token plan，cost 0）。
 * 默认跳过，仅在 `RUN_E2E=1` 时运行：
 *   RUN_E2E=1 pnpm exec vitest run opencode.e2e
 *
 * 这是跨平台愿景的关键验证：OpenCode 作为一个接入 MiMo 的 agent，不经 API 计费。
 */
describe.skipIf(!process.env.RUN_E2E)('OpenCodeAdapter 真实端到端（MiMo）', () => {
  it('能跑通 spawn → 解析 → result 链路', async () => {
    const adapter = new OpenCodeAdapter();
    const session = await adapter.start({
      name: 'e2e-oc',
      platform: 'opencode',
      role: '测试',
      model: 'xiaomi-token-plan-cn/mimo-v2.5-pro',
    });
    await adapter.send(session, '只回复两个字符：OK');

    const outputs: AgentOutput[] = [];
    for await (const o of adapter.stream(session)) outputs.push(o);
    await adapter.stop(session);

    const result = outputs.find((o) => o.kind === 'result');
    expect(result).toBeDefined();
    expect((result as { isError: boolean }).isError).toBe(false);
  }, 120_000);
});
