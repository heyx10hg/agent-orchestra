import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseTeamConfig, loadTeamConfig, selectAgent } from './config.js';

const here = dirname(fileURLToPath(import.meta.url));
const exampleYaml = resolve(here, '../../../examples/team.example.yaml');

describe('parseTeamConfig', () => {
  it('解析合法配置并返回类型化结果', () => {
    const cfg = parseTeamConfig(`
team: demo
agents:
  - name: leader
    platform: claude-code
    role: 负责人
    permissions: [plan, review]
task:
  description: 做个待办应用
`);
    expect(cfg.team).toBe('demo');
    expect(cfg.agents).toHaveLength(1);
    expect(cfg.agents[0].name).toBe('leader');
    expect(cfg.task.description).toBe('做个待办应用');
  });

  it('缺少 agents 时报错', () => {
    expect(() => parseTeamConfig('team: demo\ntask:\n  description: x')).toThrow();
  });

  it('agent 缺少 name 时报错', () => {
    expect(() =>
      parseTeamConfig('team: demo\nagents:\n  - platform: claude-code\n    role: r\ntask:\n  description: x'),
    ).toThrow();
  });
});

describe('loadTeamConfig', () => {
  it('能加载仓库内的示例配置', () => {
    const cfg = loadTeamConfig(exampleYaml);
    expect(cfg.team).toBe('demo-webapp');
    expect(cfg.agents.length).toBeGreaterThan(0);
  });
});

describe('selectAgent', () => {
  const cfg = parseTeamConfig(`
team: demo
agents:
  - name: leader
    platform: claude-code
    role: 负责人
  - name: frontend
    platform: opencode
    role: 前端
task:
  description: x
`);

  it('按名称选中 agent', () => {
    expect(selectAgent(cfg, 'frontend').name).toBe('frontend');
  });

  it('未指定名称时取第一个', () => {
    expect(selectAgent(cfg).name).toBe('leader');
  });

  it('名称不存在时报错', () => {
    expect(() => selectAgent(cfg, 'backend')).toThrow();
  });
});
