import { spawn as nodeSpawn } from 'node:child_process';
import type { AgentAdapter, AgentConfig, AgentOutput, AgentSession } from '@agent-orchestra/core';
import { OpenCodeJsonParser } from './opencode-json.js';
import { pipeChildToQueue } from './streaming.js';
import type { SpawnFn } from './claude-code.js';

export interface OpenCodeAdapterOptions {
  /** 可注入的 spawn 实现，默认 node:child_process.spawn */
  spawnFn?: SpawnFn;
  /** opencode 二进制路径，默认 'opencode' */
  binPath?: string;
}

interface SessionState {
  child: any;
  stream: AsyncIterable<AgentOutput>;
}

/**
 * OpenCode 平台适配器。
 *
 * 通过 `opencode run <prompt> -m <provider/model> --format json` 调用本机 OpenCode，
 * 复用其已配置的订阅 provider（如接入 MiMo 的 xiaomi-token-plan-cn），实现真正的
 * 跨平台多 agent 协同——与 Claude Code adapter 并列，由编排器统一驱动。
 */
export class OpenCodeAdapter implements AgentAdapter {
  private readonly spawnFn: SpawnFn;
  private readonly binPath: string;
  private readonly sessions = new Map<string, SessionState>();

  constructor(options: OpenCodeAdapterOptions = {}) {
    this.spawnFn = options.spawnFn ?? (nodeSpawn as unknown as SpawnFn);
    this.binPath = options.binPath ?? 'opencode';
  }

  /** 拼装传给 opencode 的命令行参数 */
  buildArgv(prompt: string, config: AgentConfig): string[] {
    const argv = ['run', prompt, '--format', 'json'];
    if (config.model) argv.push('-m', config.model);
    return argv;
  }

  async start(config: AgentConfig): Promise<AgentSession> {
    return { id: crypto.randomUUID(), config };
  }

  async send(session: AgentSession, message: string): Promise<void> {
    const argv = this.buildArgv(message, session.config);
    const child = this.spawnFn(this.binPath, argv, {
      cwd: session.config.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stream = pipeChildToQueue(child, new OpenCodeJsonParser());
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
}
