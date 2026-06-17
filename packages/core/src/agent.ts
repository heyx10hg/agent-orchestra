/**
 * Provider 路由配置：按 agent 注入后端模型来源。
 *
 * 复刻用户 shell 中 `claude` 函数的 CLAUDE_CODE_PROVIDER 路由能力——
 * 让不同角色用不同成本档的模型（如 leader 用 official，worker 用更便宜的后端）。
 * 全部留空则继承环境变量（即本机已登录的 official 订阅）。
 */
export interface ProviderProfile {
  /** 对应 ANTHROPIC_BASE_URL */
  baseUrl?: string;
  /** 对应 ANTHROPIC_AUTH_TOKEN */
  authToken?: string;
  /** 对应 ANTHROPIC_MODEL */
  model?: string;
}

/** 单个 agent 的运行配置 */
export interface AgentConfig {
  /** agent 名称（团队内唯一） */
  name: string;
  /** 平台标识，如 'claude-code' */
  platform: string;
  /** 角色描述，会作为系统语境注入 */
  role: string;
  /** 权限标签，如 ['plan', 'review', 'merge'] */
  permissions?: string[];
  /** 平台原生 model 标识（如 OpenCode 的 `provider/model`），透传给底层 CLI */
  model?: string;
  /** 可选的 provider 路由（用于 Claude Code 等通过环境变量注入后端的平台） */
  provider?: ProviderProfile;
  /** 权限模式，透传给底层 CLI（如 claude 的 --permission-mode） */
  permissionMode?: string;
  /** 工作目录 */
  cwd?: string;
}

/** 一次 agent 会话的句柄 */
export interface AgentSession {
  /** 会话唯一标识 */
  id: string;
  /** 关联的 agent 配置 */
  config: AgentConfig;
}

/** adapter 归一化后的输出事件 */
export type AgentOutput =
  | { kind: 'system'; subtype: string; raw: unknown }
  | { kind: 'assistant'; text: string; raw: unknown }
  | { kind: 'result'; text: string; isError: boolean; raw: unknown }
  | { kind: 'error'; message: string; raw: unknown };

/**
 * 平台适配器统一接口。各平台 adapter 把自身 CLI 的无头模式封装成这套契约，
 * 上层编排器无需关心平台差异。
 */
export interface AgentAdapter {
  /** 创建一次会话（此时尚未真正启动子进程） */
  start(config: AgentConfig): Promise<AgentSession>;
  /** 向会话发送一条消息（M1 语义：以该消息启动一次性任务） */
  send(session: AgentSession, message: string): Promise<void>;
  /** 异步迭代归一化输出 */
  stream(session: AgentSession): AsyncIterable<AgentOutput>;
  /** 停止会话并清理资源 */
  stop(session: AgentSession): Promise<void>;
}
