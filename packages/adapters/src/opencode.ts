import { spawn as nodeSpawn } from 'node:child_process';
import type { AgentAdapter, AgentConfig, AgentOutput, AgentSession } from '@agent-orchestra/core';
import { OpenCodeJsonParser } from './opencode-json.js';
import { pipeChildToQueue, captureSessionId } from './streaming.js';
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
  /** 平台会话 id，用于后续轮次 -s 续接 */
  platformSessionId?: string;
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

  /** 拼装传给 opencode 的命令行参数；传入 resumeId 时用 -s 续接会话（多轮省 token） */
  buildArgv(prompt: string, config: AgentConfig, resumeId?: string): string[] {
    const argv = ['run', prompt, '--format', 'json'];
    if (resumeId) argv.push('-s', resumeId);
    if (config.model) argv.push('-m', config.model);
    return argv;
  }

  async start(config: AgentConfig): Promise<AgentSession> {
    return { id: crypto.randomUUID(), config };
  }

  async send(session: AgentSession, message: string): Promise<void> {
    const prev = this.sessions.get(session.id);
    const argv = this.buildArgv(message, session.config, prev?.platformSessionId);
    const child = this.spawnFn(this.binPath, argv, {
      cwd: session.config.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const state: SessionState = { child, stream: undefined as never, platformSessionId: prev?.platformSessionId };
    state.stream = captureSessionId(pipeChildToQueue(child, new OpenCodeJsonParser()), (id) => {
      state.platformSessionId = id;
    });
    this.sessions.set(session.id, state);
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
