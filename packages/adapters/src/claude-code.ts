import { spawn as nodeSpawn } from 'node:child_process';
import type { AgentAdapter, AgentConfig, AgentOutput, AgentSession } from '@agent-orchestra/core';
import { StreamJsonParser } from './stream-json.js';
import { pipeChildToQueue } from './streaming.js';

/** 与 child_process.spawn 兼容的最小签名，便于测试注入 */
export type SpawnFn = (command: string, args: string[], options: any) => any;

export interface ClaudeCodeAdapterOptions {
  /** 可注入的 spawn 实现，默认 node:child_process.spawn */
  spawnFn?: SpawnFn;
  /** claude 二进制路径，默认 'claude'（由 PATH 解析到真实二进制） */
  binPath?: string;
}

interface SessionState {
  child: any;
  stream: AsyncIterable<AgentOutput>;
}

/**
 * Claude Code 平台适配器。
 *
 * 通过子进程调用 `claude -p <prompt> --output-format stream-json --verbose`，
 * 复用使用者本机已登录的订阅额度，并支持按 ProviderProfile 注入后端路由。
 */
export class ClaudeCodeAdapter implements AgentAdapter {
  private readonly spawnFn: SpawnFn;
  private readonly binPath: string;
  private readonly sessions = new Map<string, SessionState>();

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.spawnFn = options.spawnFn ?? (nodeSpawn as unknown as SpawnFn);
    this.binPath = options.binPath ?? 'claude';
  }

  /** 拼装传给 claude 的命令行参数 */
  buildArgv(prompt: string, config: AgentConfig): string[] {
    const argv = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    if (config.provider?.model) argv.push('--model', config.provider.model);
    if (config.permissionMode) argv.push('--permission-mode', config.permissionMode);
    return argv;
  }

  /**
   * 在当前环境基础上叠加 ProviderProfile 对应的 ANTHROPIC_* 变量。
   *
   * 注入自定义 token 时会清除 ANTHROPIC_API_KEY，避免残留的 API key 覆盖
   * AUTH_TOKEN（与用户 shell 函数的 `env -u ANTHROPIC_API_KEY` 行为一致）。
   */
  buildEnv(config: AgentConfig): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const p = config.provider;
    if (p?.baseUrl) env.ANTHROPIC_BASE_URL = p.baseUrl;
    if (p?.authToken) {
      env.ANTHROPIC_AUTH_TOKEN = p.authToken;
      delete env.ANTHROPIC_API_KEY;
    }
    if (p?.model) env.ANTHROPIC_MODEL = p.model;
    return env;
  }

  async start(config: AgentConfig): Promise<AgentSession> {
    return { id: crypto.randomUUID(), config };
  }

  async send(session: AgentSession, message: string): Promise<void> {
    const argv = this.buildArgv(message, session.config);
    const env = this.buildEnv(session.config);
    // stdio[0]='ignore'：print 模式不读 stdin，避免 "no stdin data received in 3s" 的等待
    const child = this.spawnFn(this.binPath, argv, {
      env,
      cwd: session.config.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stream = pipeChildToQueue(child, new StreamJsonParser());
    this.sessions.set(session.id, { child, stream });
  }

  stream(session: AgentSession): AsyncIterable<AgentOutput> {
    const state = this.sessions.get(session.id);
    if (!state) throw new Error(`会话尚未启动（未调用 send）：${session.id}`);
    return state.stream;
  }

  async stop(session: AgentSession): Promise<void> {
    const state = this.sessions.get(session.id);
    if (!state) return;
    state.child.kill?.();
    this.sessions.delete(session.id);
  }

  /** 检查 claude 是否可用（运行 `claude --version`） */
  async checkAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const child = this.spawnFn(this.binPath, ['--version'], {});
        child.on('error', () => resolve(false));
        child.on('close', (code: number | null) => resolve(code === 0));
      } catch {
        resolve(false);
      }
    });
  }
}
