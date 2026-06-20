import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Blackboard } from './blackboard.js';

describe('Blackboard', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ao-bb-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('追加任务到 TASKS.md 并可读回', () => {
    const bb = new Blackboard(dir);
    bb.addTask('leader', '实现登录接口');
    expect(existsSync(join(dir, 'TASKS.md'))).toBe(true);
    const tasks = bb.read('TASKS.md');
    expect(tasks).toContain('实现登录接口');
    expect(tasks).toContain('leader');
  });

  it('追加决策到 DECISIONS.md', () => {
    const bb = new Blackboard(dir);
    bb.addDecision('leader', '采用 SQLite 作为存储');
    expect(bb.read('DECISIONS.md')).toContain('采用 SQLite');
  });

  it('多次追加按顺序累积', () => {
    const bb = new Blackboard(dir);
    bb.addTask('leader', '任务一');
    bb.addTask('worker', '任务二');
    const tasks = bb.read('TASKS.md');
    expect(tasks.indexOf('任务一')).toBeLessThan(tasks.indexOf('任务二'));
  });

  it('读不存在的文件返回空字符串', () => {
    const bb = new Blackboard(dir);
    expect(bb.read('CONTRACTS.md')).toBe('');
  });
});
