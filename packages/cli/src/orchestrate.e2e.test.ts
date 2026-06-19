import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orchestrateTask } from './orchestrate.js';
import { JsonlMessageBus } from '@agent-orchestra/core';

/**
 * 真实双 agent 协同：Claude Code leader（official）↔ OpenCode worker（MiMo）。
 * 默认跳过，仅 `RUN_E2E=1` 运行（会消耗一次 official 额度 + 一次 MiMo）。
 *   RUN_E2E=1 pnpm exec vitest run orchestrate.e2e
 */
describe.skipIf(!process.env.RUN_E2E)('orchestrate 真实双 agent（跨平台）', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('leader 拆解 → worker 执行，消息真实流经总线', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ao-e2e-'));
    const configPath = join(dir, 'team.yaml');
    const busPath = join(dir, 'messages.jsonl');
    writeFileSync(
      configPath,
      `team: e2e
agents:
  - name: leader
    platform: claude-code
    role: 技术负责人
    permissions: [plan, review, merge]
  - name: worker
    platform: opencode
    role: 助手
    model: xiaomi-token-plan-cn/mimo-v2.5-pro
task:
  description: 用一句话说明什么是 REST API
`,
      'utf8',
    );

    const code = await orchestrateTask({ configPath, busPath, log: () => {} });
    expect(code).toBe(0);

    const bus = new JsonlMessageBus(busPath);
    expect(bus.list({ type: 'task' })).toHaveLength(1);
    expect(bus.list({ type: 'report' })).toHaveLength(1);
  }, 180_000);
});
