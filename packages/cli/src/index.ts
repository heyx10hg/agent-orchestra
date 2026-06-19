#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runTask } from './run.js';
import { orchestrateTask } from './orchestrate.js';

const HELP = `agent-orchestra — 本地多 agent 协同编排工具

用法：
  agent-orchestra run <团队配置.yaml> 中的单个 agent
    run --config <yaml> [--agent <名称>] [--dry-run]

  agent-orchestra orchestrate  leader→worker 协同闭环（跨平台）
    orchestrate --config <yaml> [--leader <名称>] [--worker <名称>] [--review]

通用选项：
  --config, -c   团队配置 YAML 路径（必填）
  --help,   -h   显示帮助

run 选项：
  --agent,  -a   要运行的 agent 名称（缺省取配置中第一个）
  --dry-run      只打印将要执行的命令与环境，不实际调用

orchestrate 选项：
  --leader       leader agent 名称（缺省：有 plan/review/merge 权限者）
  --worker       worker agent 名称（缺省：第一个非 leader）
  --review       worker 汇报后让 leader 评审并产出 decision
`;

async function main(argv: string[]): Promise<number> {
  const command = argv[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  if (command === 'run') {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: {
        config: { type: 'string', short: 'c' },
        agent: { type: 'string', short: 'a' },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });

    if (values.help) {
      process.stdout.write(HELP);
      return 0;
    }
    if (!values.config) {
      process.stderr.write('错误：缺少 --config 参数\n\n' + HELP);
      return 2;
    }

    return runTask({
      configPath: values.config,
      agentName: values.agent,
      dryRun: values['dry-run'],
    });
  }

  if (command === 'orchestrate') {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: {
        config: { type: 'string', short: 'c' },
        leader: { type: 'string' },
        worker: { type: 'string' },
        review: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });

    if (values.help) {
      process.stdout.write(HELP);
      return 0;
    }
    if (!values.config) {
      process.stderr.write('错误：缺少 --config 参数\n\n' + HELP);
      return 2;
    }

    return orchestrateTask({
      configPath: values.config,
      leaderName: values.leader,
      workerName: values.worker,
      review: values.review,
    });
  }

  process.stderr.write(`未知命令：${command}\n\n${HELP}`);
  return 2;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`运行失败：${err?.message ?? err}\n`);
    process.exit(1);
  });
