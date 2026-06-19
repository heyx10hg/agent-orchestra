import { describe, it, expect } from 'vitest';
import { pickLeader, pickWorker } from './orchestrate.js';
import { parseTeamConfig } from './config.js';

const config = parseTeamConfig(`
team: demo
agents:
  - name: frontend
    platform: opencode
    role: 前端
    permissions: [code]
  - name: leader
    platform: claude-code
    role: 负责人
    permissions: [plan, review, merge]
  - name: backend
    platform: codex
    role: 后端
    permissions: [code]
task:
  description: 做个应用
`);

describe('pickLeader', () => {
  it('优先选有 plan/review/merge 权限的 agent', () => {
    expect(pickLeader(config).name).toBe('leader');
  });

  it('无权限标记时回退到第一个 agent', () => {
    const plain = parseTeamConfig(`
team: d
agents:
  - name: a
    platform: opencode
    role: x
  - name: b
    platform: opencode
    role: y
task:
  description: t
`);
    expect(pickLeader(plain).name).toBe('a');
  });
});

describe('pickWorker', () => {
  it('选第一个非 leader 的 agent', () => {
    const leader = pickLeader(config);
    expect(pickWorker(config, leader)!.name).toBe('frontend');
  });
});
