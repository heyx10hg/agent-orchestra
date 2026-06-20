import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export interface Worktree {
  /** worktree 目录绝对路径 */
  path: string;
  /** 对应的分支名 */
  branch: string;
  /** 基线分支（创建 worktree 时主仓库所在分支），用于 diff/合并 */
  base: string;
}

/**
 * 工作区管理器：为每个 agent 分配独立的 git worktree 分支，使多个 agent 可以
 * 并行写码而互不踩踏；leader 负责审查与合并。从机制上避免并发修改冲突。
 */
export class WorkspaceManager {
  constructor(
    readonly repoDir: string,
    /** worktree 存放根目录，默认 <repo>/.agent-orchestra/worktrees */
    private readonly worktreeRoot = join(repoDir, '.agent-orchestra', 'worktrees'),
  ) {}

  private git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
  }

  /** 为 agent 创建分支 `agent/<name>` 及对应 worktree */
  createWorktree(agentName: string): Worktree {
    const branch = `agent/${agentName}`;
    const base = this.git(this.repoDir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    const path = join(this.worktreeRoot, agentName);
    this.git(this.repoDir, 'worktree', 'add', '-b', branch, path);
    return { path, branch, base };
  }

  /** worktree 内是否有未提交改动（含未跟踪文件） */
  hasUncommitted(worktreePath: string): boolean {
    return this.git(worktreePath, 'status', '--porcelain').trim() !== '';
  }

  /** worktree 分支相对基线是否有领先提交（worker 自行 commit 的情况） */
  hasCommitsVsBase(worktreePath: string, base: string): boolean {
    const count = this.git(worktreePath, 'rev-list', '--count', `${base}..HEAD`).trim();
    return count !== '' && count !== '0';
  }

  /** 综合判断：worktree 是否有任何改动（未提交或已提交领先基线） */
  hasChanges(worktreePath: string, base: string): boolean {
    return this.hasUncommitted(worktreePath) || this.hasCommitsVsBase(worktreePath, base);
  }

  /** 相对基线的改动摘要：已提交 diff（base...HEAD）+ 未提交 status/diff */
  diff(worktreePath: string, base: string): string {
    const committed = this.git(worktreePath, 'diff', `${base}...HEAD`);
    const status = this.git(worktreePath, 'status', '--porcelain');
    const uncommitted = this.git(worktreePath, 'diff');
    return [status, uncommitted, committed].filter((s) => s.trim() !== '').join('\n');
  }

  /** 在 worktree 内暂存并提交全部改动（仅在有未提交内容时） */
  commitAll(worktreePath: string, message: string): void {
    this.git(worktreePath, 'add', '-A');
    this.git(worktreePath, 'commit', '-m', message);
  }

  /** 若 worktree 有未提交改动则提交，使 worker 产出统一落到分支提交上 */
  commitIfDirty(worktreePath: string, message: string): void {
    if (this.hasUncommitted(worktreePath)) this.commitAll(worktreePath, message);
  }

  /** 在主仓库把指定分支合并进当前分支（leader 审查通过后调用） */
  merge(branch: string): void {
    this.git(this.repoDir, 'merge', '--no-ff', '-m', `merge ${branch}`, branch);
  }

  /** 移除 worktree（强制，丢弃未提交内容） */
  remove(worktreePath: string): void {
    this.git(this.repoDir, 'worktree', 'remove', '--force', worktreePath);
  }
}
