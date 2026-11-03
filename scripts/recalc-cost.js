#!/usr/bin/env node
/**
 * 项目费用对账 / 重算。
 *
 * 不变量：projects.total_cost === 该项目所有 succeeded 任务的 cost 合计。
 * 旧结算实现是「先读状态再无条件 UPDATE + total_cost 自增」，同一任务被 worker
 * 与 pollJob 并发结算时会重复累加；崩溃也可能只写任务不记账。应用层已改为
 * CAS + 单事务，本脚本负责把历史数据拉回不变量。
 *
 * 用法：
 *   node scripts/recalc-cost.js                 # 只对账，不改数据（默认）
 *   node scripts/recalc-cost.js --apply         # 把有差异的项目写回重算值
 *   node scripts/recalc-cost.js --project <id>  # 只看/只改单个项目
 *   node scripts/recalc-cost.js --mock          # 额外排查「mock 演练却被扣费」的历史任务
 *   node scripts/recalc-cost.js --mock --apply  # 把这些任务的 cost 归零后再重算
 *   node scripts/recalc-cost.js --json          # 机器可读输出
 *
 * 连接串：SUDA_DATABASE_URL 或 DATABASE_URL，缺省 postgres://localhost:5432/yimu
 * 建议先跑 scripts/backup-db.sh。
 */
'use strict';

const postgres = require('postgres');

function dbUrl() {
  const raw =
    process.env.SUDA_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://localhost:5432/yimu';
  return raw.split('?')[0];
}

function parseArgs(argv) {
  const args = { apply: false, json: false, mock: false, project: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--json') args.json = true;
    else if (a === '--mock') args.mock = true;
    else if (a === '--project') args.project = argv[(i += 1)] ?? null;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const HELP = `项目费用对账脚本

  node scripts/recalc-cost.js                只对账，不改数据（默认）
  node scripts/recalc-cost.js --apply        写回重算值
  node scripts/recalc-cost.js --project <id> 只处理单个项目
  node scripts/recalc-cost.js --mock         排查 mock 演练却被扣费的任务（配合 --apply 归零）
  node scripts/recalc-cost.js --json         输出 JSON

连接串：SUDA_DATABASE_URL / DATABASE_URL（缺省 postgres://localhost:5432/yimu）`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const sql = postgres(dbUrl(), { max: 1 });
  try {
    // --mock：排查「mock 演练产物却被扣费」的历史任务。
    // 只看库里能识别的信号（产物自报 mock / billing.free 标记 / 本地 mock 输出目录）；
    // 改造前的占位图没有可识别特征，所以统计金额只是下限。
    let mockReport = null;
    if (args.mock) {
      const mockRows = await sql`
        SELECT id, project_id, job_type, COALESCE(cost, 0)::float8 AS cost
        FROM generation_jobs
        WHERE status = 'succeeded'
          AND COALESCE(cost, 0) > 0
          AND (
            output_data ->> 'mock' = 'true'
            OR (output_data -> 'billing' ->> 'free') LIKE 'mock%'
            OR (output_data ->> 'url') LIKE '%/uploads/mock/%'
            OR (output_data ->> 'videoUrl') LIKE '%/uploads/mock/%'
          )
          AND (${args.project}::uuid IS NULL OR project_id = ${args.project}::uuid)
      `;
      const mockTotal = mockRows.reduce((sum, r) => sum + Number(r.cost), 0);
      if (args.apply && mockRows.length > 0) {
        await sql`
          UPDATE generation_jobs
          SET cost = 0, _updated_at = CURRENT_TIMESTAMP
          WHERE id IN ${sql(mockRows.map((r) => r.id))}
        `;
      }
      mockReport = {
        count: mockRows.length,
        amount: Number(mockTotal.toFixed(4)),
        refunded: Boolean(args.apply),
      };
    }

    const rows = await sql`
      SELECT p.id,
             p.title,
             COALESCE(p.total_cost, 0)::float8 AS project_total,
             COALESCE((
               SELECT SUM(COALESCE(j.cost, 0))
               FROM generation_jobs j
               WHERE j.project_id = p.id AND j.status = 'succeeded'
             ), 0)::float8 AS job_sum
      FROM projects p
      WHERE (${args.project}::uuid IS NULL OR p.id = ${args.project}::uuid)
      ORDER BY p._created_at DESC
    `;

    const report = rows.map((r) => ({
      projectId: r.id,
      title: r.title,
      projectTotal: Number(Number(r.project_total).toFixed(4)),
      jobSum: Number(Number(r.job_sum).toFixed(4)),
      delta: Number((Number(r.project_total) - Number(r.job_sum)).toFixed(4)),
    }));
    // 浮点比较留 0.00005 容差（numeric(10,4) 精度以下的差异无意义）
    const mismatched = report.filter((r) => Math.abs(r.delta) > 0.00005);

    const applied = [];
    if (args.apply) {
      for (const item of mismatched) {
        // 写入时现算，避免「对账到写回」之间的新结算被旧快照覆盖
        const updated = await sql`
          UPDATE projects p
          SET total_cost = COALESCE((
                SELECT SUM(COALESCE(j.cost, 0))
                FROM generation_jobs j
                WHERE j.project_id = p.id AND j.status = 'succeeded'
              ), 0),
              _updated_at = CURRENT_TIMESTAMP
          WHERE p.id = ${item.projectId}
          RETURNING COALESCE(p.total_cost, 0)::float8 AS total
        `;
        applied.push({
          projectId: item.projectId,
          before: item.projectTotal,
          after: Number(Number(updated[0]?.total ?? 0).toFixed(4)),
        });
      }
    }

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            total: report.length,
            mismatched: mismatched.length,
            mock: mockReport,
            applied,
            report,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (mockReport) {
      const money = mockReport.amount.toFixed(4);
      if (mockReport.count === 0) {
        console.log('[recalc-cost] 未发现「mock 演练却被扣费」的历史任务');
      } else if (mockReport.refunded) {
        console.log(
          `[recalc-cost] 已把 ${mockReport.count} 条 mock 任务费用归零（合计 ${money} 元），` +
            '项目费用将在下方一并重算',
        );
      } else {
        console.log(
          `[recalc-cost] 发现 ${mockReport.count} 条 mock 演练任务被扣费，合计至少 ${money} 元。` +
            '加 --mock --apply 归零（历史占位图可能无法识别，实际金额只会更多）',
        );
      }
    }

    console.log(`[recalc-cost] 项目数 ${report.length}`);
    if (mismatched.length === 0) {
      console.log('[recalc-cost] 全部项目 total_cost 与成功任务金额一致，无需处理');
      return;
    }

    console.log(`[recalc-cost] 发现 ${mismatched.length} 个项目不一致：`);
    for (const r of mismatched) {
      const sign = r.delta > 0 ? '多记' : '少记';
      console.log(
        `  - ${r.title || '(无标题)'} ${r.projectId}\n` +
          `    库内 ${r.projectTotal.toFixed(4)} / 任务合计 ${r.jobSum.toFixed(4)}` +
          ` → ${sign} ${Math.abs(r.delta).toFixed(4)} 元`,
      );
    }

    if (!args.apply) {
      console.log('[recalc-cost] 这是只读对账。确认无误后加 --apply 写回。');
      return;
    }
    console.log(`[recalc-cost] 已重算 ${applied.length} 个项目：`);
    for (const a of applied) {
      console.log(`  - ${a.projectId}: ${a.before.toFixed(4)} → ${a.after.toFixed(4)}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(`[recalc-cost] 失败：${e.message}`);
  process.exitCode = 1;
});
