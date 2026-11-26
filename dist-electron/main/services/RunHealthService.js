"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runHealthService = exports.RunHealthService = void 0;
const os_1 = __importDefault(require("os"));
const db_1 = require("../database/db");
const readCpuTimes = () => {
    let idle = 0;
    let total = 0;
    for (const cpu of os_1.default.cpus()) {
        const t = cpu.times;
        idle += t.idle;
        total += t.user + t.nice + t.sys + t.irq + t.idle;
    }
    return { idle, total };
};
const round1 = (n) => Math.round(n * 10) / 10;
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
class RunHealthService {
    samplers = new Map();
    /** Baseline for ad-hoc snapshots (independent of any run). */
    snapshotBaseline = null;
    /** Begin sampling for a batch. Idempotent per batch id. */
    start(batchId, projectId) {
        this.finish(batchId);
        const state = {
            projectId,
            startedAt: new Date().toISOString(),
            lastCpu: readCpuTimes(),
            samples: [],
            timer: setInterval(() => this.collect(batchId), 2000),
        };
        // Never hold the process open just for health sampling.
        state.timer.unref?.();
        this.samplers.set(batchId, state);
        this.collect(batchId);
    }
    collect(batchId) {
        const state = this.samplers.get(batchId);
        if (!state)
            return;
        const current = readCpuTimes();
        const idleDelta = current.idle - state.lastCpu.idle;
        const totalDelta = current.total - state.lastCpu.total;
        const cpuPercent = totalDelta > 0 ? round1(Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100))) : null;
        state.lastCpu = current;
        state.samples.push({
            cpuPercent,
            memUsedMb: (os_1.default.totalmem() - os_1.default.freemem()) / (1024 * 1024),
            load1: os_1.default.loadavg()[0] || 0,
        });
    }
    /** Stop sampling; persist the aggregate for the batch; return it (null if it was never started). */
    finish(batchId) {
        if (!batchId) {
            // Desktop single-run convenience: finish whichever sampler is active.
            const first = this.samplers.keys().next();
            if (first.done)
                return null;
            batchId = first.value;
        }
        const state = this.samplers.get(batchId);
        if (!state)
            return null;
        clearInterval(state.timer);
        this.samplers.delete(batchId);
        // One last sample so very short runs still get an aggregate.
        const current = readCpuTimes();
        const idleDelta = current.idle - state.lastCpu.idle;
        const totalDelta = current.total - state.lastCpu.total;
        state.samples.push({
            cpuPercent: totalDelta > 0 ? round1(Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100))) : null,
            memUsedMb: (os_1.default.totalmem() - os_1.default.freemem()) / (1024 * 1024),
            load1: os_1.default.loadavg()[0] || 0,
        });
        const cpuSamples = state.samples.map((s) => s.cpuPercent).filter((v) => v !== null);
        const memSamples = state.samples.map((s) => s.memUsedMb);
        const loadSamples = state.samples.map((s) => s.load1);
        const endedAt = new Date().toISOString();
        const summary = {
            batchId,
            samples: state.samples.length,
            cpuAvgPercent: cpuSamples.length ? round1(avg(cpuSamples)) : null,
            cpuPeakPercent: cpuSamples.length ? round1(Math.max(...cpuSamples)) : null,
            memAvgMb: memSamples.length ? round1(avg(memSamples)) : null,
            memPeakMb: memSamples.length ? round1(Math.max(...memSamples)) : null,
            memTotalMb: Math.round(os_1.default.totalmem() / (1024 * 1024)),
            load1Peak: loadSamples.length ? round1(Math.max(...loadSamples)) : 0,
            startedAt: state.startedAt,
            endedAt,
        };
        try {
            (0, db_1.getDb)()
                .prepare(`INSERT INTO execution_batch_metrics
           (batch_id, project_id, samples, cpu_avg, cpu_peak, mem_avg_mb, mem_peak_mb, mem_total_mb, load1_peak, started_at, ended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(batch_id) DO UPDATE SET
             samples = excluded.samples,
             cpu_avg = excluded.cpu_avg,
             cpu_peak = excluded.cpu_peak,
             mem_avg_mb = excluded.mem_avg_mb,
             mem_peak_mb = excluded.mem_peak_mb,
             mem_total_mb = excluded.mem_total_mb,
             load1_peak = excluded.load1_peak,
             started_at = excluded.started_at,
             ended_at = excluded.ended_at`)
                .run(summary.batchId, state.projectId, summary.samples, summary.cpuAvgPercent, summary.cpuPeakPercent, summary.memAvgMb, summary.memPeakMb, summary.memTotalMb, summary.load1Peak, summary.startedAt, summary.endedAt);
        }
        catch (err) {
            // Health is best-effort telemetry — never fail the run because of it.
            console.error('[ControlCenter] Failed to persist batch health metrics:', err);
        }
        return summary;
    }
    /** On-demand host snapshot for the live strip. Cheap; no persistence. */
    snapshot() {
        let cpuPercent = null;
        const current = readCpuTimes();
        if (this.snapshotBaseline) {
            const idleDelta = current.idle - this.snapshotBaseline.idle;
            const totalDelta = current.total - this.snapshotBaseline.total;
            if (totalDelta > 0)
                cpuPercent = round1(Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)));
        }
        this.snapshotBaseline = current;
        const memTotalMb = os_1.default.totalmem() / (1024 * 1024);
        const memUsedMb = memTotalMb - os_1.default.freemem() / (1024 * 1024);
        return {
            cpuPercent,
            memUsedMb: round1(memUsedMb),
            memTotalMb: Math.round(memTotalMb),
            memPercent: round1((memUsedMb / memTotalMb) * 100),
            load1: round1(os_1.default.loadavg()[0] || 0),
            timestamp: new Date().toISOString(),
        };
    }
    /** Persisted per-batch health, or the latest captured batch for the project when no id is given. */
    getBatchHealth(projectId, batchId) {
        const db = (0, db_1.getDb)();
        const row = batchId
            ? db.prepare('SELECT * FROM execution_batch_metrics WHERE batch_id = ? AND project_id = ?').get(batchId, projectId)
            : db
                .prepare('SELECT * FROM execution_batch_metrics WHERE project_id = ? ORDER BY ended_at DESC LIMIT 1')
                .get(projectId);
        if (!row)
            return null;
        return {
            batchId: row.batch_id,
            samples: Number(row.samples),
            cpuAvgPercent: row.cpu_avg === null || row.cpu_avg === undefined ? null : Number(row.cpu_avg),
            cpuPeakPercent: row.cpu_peak === null || row.cpu_peak === undefined ? null : Number(row.cpu_peak),
            memAvgMb: row.mem_avg_mb === null || row.mem_avg_mb === undefined ? null : Number(row.mem_avg_mb),
            memPeakMb: row.mem_peak_mb === null || row.mem_peak_mb === undefined ? null : Number(row.mem_peak_mb),
            memTotalMb: Number(row.mem_total_mb),
            load1Peak: Number(row.load1_peak || 0),
            startedAt: row.started_at,
            endedAt: row.ended_at,
        };
    }
}
exports.RunHealthService = RunHealthService;
/** Process-wide samplers — the engine drives start/finish; the bridges read snapshots. */
exports.runHealthService = new RunHealthService();
