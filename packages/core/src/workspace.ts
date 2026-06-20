import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export interface Worktree {
  /** worktree 目录绝对路径 */
  path: string;
  /** 对应的分支名 */
  branch: string;
}

/**
 * 工作区管理器：为每个 agent 分配独立的 git worktree 分支，使多个 agent 可以
 * 并行写码而互不踩踏；leader 负责审查与合并。从机制上避免并发修改冲突。
 */
export class WorkspaceManager {
  constructor(
    private readonly repoDir: string,
    /** worktree 存放根目录，默认 <repo>/.agent-orchestra/worktrees */
    private readonly worktreeRoot = join(repoDir, '.agent-orchestra', 'worktrees'),
  ) {}

  private git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
  }

  /** 为 agent 创建分支 `agent/<name>` 及对应 worktree */
  createWorktree(agentName: string): Worktree {
    const branch = `agent/${agentName}`;
    const path = join(this.worktreeRoot, agentName);
    this.git(this.repoDir, 'worktree', 'add', '-b', branch, path);
    return { path, branch };
  }

  /** worktree 内是否有未提交改动（含未跟踪文件） */
  hasChanges(worktreePath: string): boolean {
    return this.git(worktreePath, 'status', '--porcelain').trim() !== '';
  }

  /** worktree 内未提交改动的摘要（含未跟踪文件名） */
  diff(worktreePath: string): string {
    const tracked = this.git(worktreePath, 'diff');
    const status = this.git(worktreePath, 'status', '--porcelain');
    return [status, tracked].filter((s) => s.trim() !== '').join('\n');
  }

  /** 在 worktree 内暂存并提交全部改动 */
  commitAll(worktreePath: string, message: string): void {
    this.git(worktreePath, 'add', '-A');
    this.git(worktreePath, 'commit', '-m', message);
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
