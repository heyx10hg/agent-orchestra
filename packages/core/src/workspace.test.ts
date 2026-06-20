import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceManager } from './workspace.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

describe('WorkspaceManager', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'ao-ws-'));
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@test.com');
    git(repo, 'config', 'user.name', 'test');
    writeFileSync(join(repo, 'README.md'), '# base\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'init');
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('为 agent 创建独立 worktree 与分支', () => {
    const wm = new WorkspaceManager(repo);
    const { path, branch } = wm.createWorktree('frontend');
    expect(existsSync(path)).toBe(true);
    expect(branch).toBe('agent/frontend');
    // worktree 是独立目录，含基线文件
    expect(existsSync(join(path, 'README.md'))).toBe(true);
    wm.remove(path);
  });

  it('hasChanges 反映 worktree 内的未提交改动', () => {
    const wm = new WorkspaceManager(repo);
    const { path, base } = wm.createWorktree('w');
    expect(wm.hasChanges(path, base)).toBe(false);
    writeFileSync(join(path, 'feature.txt'), 'hello\n');
    expect(wm.hasChanges(path, base)).toBe(true);
    wm.remove(path);
  });

  it('hasChanges 也识别 worker 自行提交的改动（status 已干净）', () => {
    const wm = new WorkspaceManager(repo);
    const { path, base } = wm.createWorktree('w');
    // 模拟 worker 自己 add+commit
    writeFileSync(join(path, 'feature.txt'), 'hello\n');
    wm.commitAll(path, 'worker 自行提交');
    expect(wm.hasUncommitted(path)).toBe(false); // 工作区已干净
    expect(wm.hasChanges(path, base)).toBe(true); // 但分支领先基线
    const d = wm.diff(path, base);
    expect(d).toContain('feature.txt');
    wm.remove(path);
  });

  it('commitAll + merge 把 worktree 的改动并回主分支', () => {
    const wm = new WorkspaceManager(repo);
    const { path, branch } = wm.createWorktree('w');
    writeFileSync(join(path, 'feature.txt'), 'hello\n');
    wm.commitAll(path, 'feat: 新增 feature.txt');
    wm.merge(branch);

    expect(existsSync(join(repo, 'feature.txt'))).toBe(true);
    expect(readFileSync(join(repo, 'feature.txt'), 'utf8')).toBe('hello\n');
    wm.remove(path);
  });

  it('diff 返回未提交改动的摘要', () => {
    const wm = new WorkspaceManager(repo);
    const { path, base } = wm.createWorktree('w');
    writeFileSync(join(path, 'a.txt'), 'x\n');
    expect(wm.diff(path, base)).toContain('a.txt');
    wm.remove(path);
  });
});
