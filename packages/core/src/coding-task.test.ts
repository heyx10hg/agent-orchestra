import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orchestrator } from './orchestrator.js';
import { InMemoryMessageBus } from './message-bus.js';
import { WorkspaceManager } from './workspace.js';
import { Blackboard } from './blackboard.js';
import type { AgentAdapter, AgentConfig, AgentOutput, AgentSession } from './agent.js';

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** leader：返回脚本答案 */
class LeaderAdapter implements AgentAdapter {
  private i = 0;
  constructor(private answers: string[]) {}
  async start(config: AgentConfig): Promise<AgentSession> {
    return { id: 'l', config };
  }
  async send(): Promise<void> {}
  async *stream(): AsyncIterable<AgentOutput> {
    yield { kind: 'result', text: this.answers[Math.min(this.i++, this.answers.length - 1)], isError: false, raw: {} };
  }
  async stop(): Promise<void> {}
}

/** worker：在 cwd 内写一个文件，模拟 coding agent 的真实编辑 */
class CodingWorkerAdapter implements AgentAdapter {
  private cwd?: string;
  async start(config: AgentConfig): Promise<AgentSession> {
    this.cwd = config.cwd;
    return { id: 'w', config };
  }
  async send(): Promise<void> {
    writeFileSync(join(this.cwd!, 'feature.txt'), 'worker 写的内容\n');
  }
  async *stream(): AsyncIterable<AgentOutput> {
    yield { kind: 'result', text: '已创建 feature.txt', isError: false, raw: {} };
  }
  async stop(): Promise<void> {}
}

describe('Orchestrator.runCodingTask', () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'ao-code-'));
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.email', 't@t.com');
    git(repo, 'config', 'user.name', 't');
    writeFileSync(join(repo, 'README.md'), '# base\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'init');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  const leader: AgentConfig = { name: 'leader', platform: 'claude-code', role: '负责人' };
  const worker: AgentConfig = { name: 'coder', platform: 'opencode', role: '工程师' };

  it('worker 在 worktree 写码、leader 评审通过并合并回主分支，黑板记录任务/决策', async () => {
    const adapters: Record<string, AgentAdapter> = {
      'claude-code': new LeaderAdapter(['创建 feature.txt', '代码没问题，通过']),
      opencode: new CodingWorkerAdapter(),
    };
    const bus = new InMemoryMessageBus();
    const workspace = new WorkspaceManager(repo);
    const blackboard = new Blackboard(join(repo, '.agent-orchestra'));
    const orch = new Orchestrator({ bus, resolveAdapter: (c) => adapters[c.platform], workspace, blackboard });

    const result = await orch.runCodingTask({ leader, worker, task: '加一个 feature 文件', autoMerge: true });

    expect(result.hasChanges).toBe(true);
    expect(result.approved).toBe(true);
    expect(result.merged).toBe(true);
    // 合并后主仓库可见 worker 的文件
    expect(existsSync(join(repo, 'feature.txt'))).toBe(true);
    // 消息流含 task / report / decision
    expect(bus.list({ type: 'task' }).length).toBeGreaterThanOrEqual(1);
    expect(bus.list({ type: 'report' })).toHaveLength(1);
    expect(bus.list({ type: 'decision' })[0]).toMatchObject({ from: 'leader' });
    // 黑板记录
    expect(blackboard.read('TASKS.md')).toContain('加一个 feature 文件');
    expect(blackboard.read('DECISIONS.md')).toContain('通过');

    workspace.remove(result.worktree.path);
  });

  it('leader 不通过时不合并', async () => {
    const adapters: Record<string, AgentAdapter> = {
      'claude-code': new LeaderAdapter(['创建文件', '有问题，不通过']),
      opencode: new CodingWorkerAdapter(),
    };
    const bus = new InMemoryMessageBus();
    const workspace = new WorkspaceManager(repo);
    const orch = new Orchestrator({ bus, resolveAdapter: (c) => adapters[c.platform], workspace });

    const result = await orch.runCodingTask({ leader, worker, task: 't', autoMerge: true });
    expect(result.approved).toBe(false);
    expect(result.merged).toBe(false);
    expect(existsSync(join(repo, 'feature.txt'))).toBe(false);

    workspace.remove(result.worktree.path);
  });
});
