import { appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 共享黑板：用 markdown 文件保存团队级共享上下文，缓解各 agent 上下文窗口
 * 互相隔离、只靠消息会失真的问题。
 *
 * - TASKS.md：任务板
 * - DECISIONS.md：决策日志
 * - CONTRACTS.md：接口契约
 */
export class Blackboard {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private append(file: string, author: string, entry: string): void {
    const ts = new Date().toISOString();
    appendFileSync(join(this.dir, file), `- [${ts}] **${author}**：${entry}\n`, 'utf8');
  }

  /** 追加一条任务到任务板 */
  addTask(author: string, entry: string): void {
    this.append('TASKS.md', author, entry);
  }

  /** 追加一条决策到决策日志 */
  addDecision(author: string, entry: string): void {
    this.append('DECISIONS.md', author, entry);
  }

  /** 追加一条接口契约 */
  addContract(author: string, entry: string): void {
    this.append('CONTRACTS.md', author, entry);
  }

  /** 读取某个黑板文件的全文，不存在返回空字符串 */
  read(file: string): string {
    try {
      return readFileSync(join(this.dir, file), 'utf8');
    } catch {
      return '';
    }
  }
}
