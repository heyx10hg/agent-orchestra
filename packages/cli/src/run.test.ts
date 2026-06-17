import { describe, it, expect } from 'vitest';
import { buildPrompt } from './run.js';
import type { AgentConfig } from '@agent-orchestra/core';

const agent: AgentConfig = { name: 'leader', platform: 'claude-code', role: '技术负责人' };

describe('buildPrompt', () => {
  it('包含角色与任务描述', () => {
    const prompt = buildPrompt(agent, { description: '实现登录页' });
    expect(prompt).toContain('技术负责人');
    expect(prompt).toContain('实现登录页');
  });

  it('有 requirements 时逐条列出', () => {
    const prompt = buildPrompt(agent, { description: 'x', requirements: ['用 React', '写测试'] });
    expect(prompt).toContain('用 React');
    expect(prompt).toContain('写测试');
  });
});
