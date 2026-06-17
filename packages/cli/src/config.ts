import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { AgentConfig } from '@agent-orchestra/core';

const providerSchema = z
  .object({
    baseUrl: z.string().optional(),
    authToken: z.string().optional(),
    model: z.string().optional(),
  })
  .optional();

const agentSchema = z.object({
  name: z.string().min(1),
  platform: z.string().min(1),
  role: z.string().default(''),
  permissions: z.array(z.string()).optional(),
  provider: providerSchema,
  permissionMode: z.string().optional(),
  cwd: z.string().optional(),
});

const teamConfigSchema = z.object({
  team: z.string().min(1),
  agents: z.array(agentSchema).min(1),
  maxConcurrent: z.number().int().positive().optional(),
  task: z.object({
    description: z.string().min(1),
    requirements: z.array(z.string()).optional(),
  }),
});

export type TeamConfig = z.infer<typeof teamConfigSchema>;

/** 解析 YAML 文本为类型化团队配置 */
export function parseTeamConfig(yamlText: string): TeamConfig {
  return teamConfigSchema.parse(parseYaml(yamlText));
}

/** 从文件加载并校验团队配置 */
export function loadTeamConfig(path: string): TeamConfig {
  return parseTeamConfig(readFileSync(path, 'utf8'));
}

/** 选定要运行的 agent；缺省取首个，名称不存在则抛错 */
export function selectAgent(config: TeamConfig, name?: string): AgentConfig {
  const agent = name ? config.agents.find((a) => a.name === name) : config.agents[0];
  if (!agent) {
    const available = config.agents.map((a) => a.name).join(', ');
    throw new Error(`未找到 agent「${name}」，可选：${available}`);
  }
  return agent;
}
