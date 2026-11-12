/**
 * Rule-based issues for the Elasticsearch monitor (no AI). A rule whose
 * inputs are unknown (null) stays silent rather than guessing.
 */
import type { EsIssue, EsMonitor, EsRuleExtras, EsStat } from "@/lib/esMonitor";

const GB = 1024 ** 3;
const STALE_SCRAPE_MIN = 5;
const HEAP_CRIT_AVG = 85, HEAP_CRIT_MAX = 95, HEAP_WARN_AVG = 75;
const OLD_GC_WARN_MS = 50;
const SHARDS_PER_HEAP_GB = 20;
const CPU_CRIT = 80, CPU_WARN = 60;
const LOAD_PER_CORE = 1.5;
const DISK_CRIT_PCT = 10, DISK_WARN_PCT = 20;
const SEARCH_CRIT_MS = 1000, SEARCH_WARN_MS = 200;
const QUEUE_WARN = 100;
const OPEN_FILES_RATIO = 0.8;
const PENDING_WARN = 50;
const ORDER = { critical: 0, warning: 1, info: 2 } as const;

type Base = Omit<EsMonitor, "issues" | "health">;

const f1 = (v: number) => v.toFixed(1).replace(/\.0$/, "");
const f0 = (v: number) => Math.round(v).toLocaleString("en-US");
const ms = (v: number) => (v < 10 ? v.toFixed(2) : f0(v));

export function buildEsIssues(m: Base, x: EsRuleExtras): EsIssue[] {
  const out: EsIssue[] = [];
  const add = (severity: EsIssue["severity"], title: string, evidence: string, action: string) => out.push({ severity, title, evidence, action });
  const st = (k: string): EsStat | undefined => m.stats[k];
  const hrs = m.windowHours;
  const heapGb = m.heapMaxBytes != null ? m.heapMaxBytes / GB : null;
  const unassigned = m.shards.unassigned;

  if (m.exporterUp === false) {
    add("critical", "Monitoring cannot reach Elasticsearch", `The metrics collector on ${m.target ?? "the server"} is down.`, "Check that Elasticsearch and its metrics exporter are running on the server.");
  }
  if (m.lastScrapeAt) {
    const age = Math.floor((Date.now() - new Date(m.lastScrapeAt).getTime()) / 60_000);
    if (age > STALE_SCRAPE_MIN) add("warning", "Metrics are out of date", `Last reading ${age} min ago.`, "Numbers below may not reflect the current state.");
  }
  if (m.status === "red") {
    add("critical", "Cluster status is red", `Some data is unavailable: ${unassigned != null ? f0(unassigned) : "some"} shard copies are not assigned.`, "At least one index has no working primary copy. Searches on it fail until it is restored.");
  }
  if (m.status === "yellow" && m.nodeCount === 1) {
    add("warning", "Cluster status is yellow", `${unassigned != null ? f0(unassigned) : "Some"} backup copies cannot be placed because the cluster has only one server.`, "All data is searchable, but there is no second copy. Add a second server, or set the number of replicas to 0 for these indices to clear the warning.");
  }
  if (m.status === "yellow" && m.nodeCount != null && m.nodeCount > 1) {
    add("warning", "Cluster status is yellow", `${unassigned != null ? f0(unassigned) : "Some"} backup copies are not assigned across ${m.nodeCount} servers.`, "Check for a server that left the cluster or a full disk.");
  }
  if (x.nodeLow != null && x.nodeHigh != null && x.nodeLow < x.nodeHigh) {
    add("critical", "A server left the cluster", `Server count dropped from ${x.nodeHigh} to ${x.nodeLow} in the last ${hrs}h.`, "Check the missing server.");
  }

  const heap = st("heapPct.Heap in use");
  if (heap?.avg != null && heap.max != null) {
    const ev = `Average ${f1(heap.avg)}%, peak ${f1(heap.max)}% of ${heapGb != null ? f1(heapGb) : "?"} GB.`;
    if (heap.avg >= HEAP_CRIT_AVG || heap.max >= HEAP_CRIT_MAX) add("critical", "Memory (heap) almost full", ev, "Elasticsearch will slow down and start refusing requests. Reduce shard count or give the server more memory.");
    else if (heap.avg >= HEAP_WARN_AVG) add("warning", "Memory (heap) running high", ev, "Little room is left for heavy searches.");
  }
  if (m.breakerTrips.length) {
    add("critical", "Requests refused to protect memory", m.breakerTrips.map((b) => `${b.breaker}: ${f0(b.count)} times in ${hrs}h`).join("; "), "A search or bulk request needed more memory than was safe. Look for very large searches or aggregations.");
  }
  const oldGc = st("gc.old");
  if (oldGc?.avg != null && oldGc.avg >= OLD_GC_WARN_MS) {
    add("warning", "Long memory clean-ups", `Old-generation clean-up took ${f1(oldGc.avg)} ms of every second on average.`, "This is a sign of memory pressure and pauses all requests while it runs.");
  }
  if (m.shards.active != null && heapGb != null && m.shards.active > SHARDS_PER_HEAP_GB * heapGb) {
    add("warning", "Too many shards for the memory available", `${f0(m.shards.active)} shards on ${f1(heapGb)} GB of heap; the usual guide is ${SHARDS_PER_HEAP_GB} per GB (${f0(SHARDS_PER_HEAP_GB * heapGb)}).`, "Merge or delete small old indices, or shrink the number of shards per index.");
  }

  const cpu = st("cpu.Elasticsearch");
  if (cpu?.avg != null && cpu.max != null) {
    const ev = `Average ${f1(cpu.avg)}%, peak ${f1(cpu.max)}% over ${hrs}h.`;
    if (cpu.avg >= CPU_CRIT) add("critical", "CPU sustained above 80%", ev, "Find the heavy searches or add CPU.");
    else if (cpu.avg >= CPU_WARN) add("warning", "CPU running hot", ev, "Headroom is thin for traffic spikes.");
  }
  const load5 = st("load.5 min");
  if (m.cpuCores != null && load5?.avg != null && load5.avg > LOAD_PER_CORE * m.cpuCores) {
    add("warning", "Server is overloaded", `Average load ${load5.avg.toFixed(2)} on ${m.cpuCores} CPU cores.`, "Work is queuing for CPU or disk.");
  }

  const free = st("diskFree.Free disk")?.last;
  if (free != null && m.diskSizeBytes) {
    const pct = (free / m.diskSizeBytes) * 100;
    const ev = `${f1(free / GB)} GB free of ${f1(m.diskSizeBytes / GB)} GB (${f1(pct)}%).`;
    if (pct < DISK_CRIT_PCT) add("critical", "Free disk below 10%", ev, "Elasticsearch stops placing data on a disk this full and makes indices read-only at 5% free. Delete old indices or extend the disk now.");
    else if (pct < DISK_WARN_PCT) add("warning", "Free disk below 20%", ev, "At 15% free Elasticsearch stops creating new shard copies here. Plan a clean-up or a larger disk.");
  }
  if (m.readOnlyIndices != null && m.readOnlyIndices > 0) {
    add("critical", "Indices are read-only", `${f0(m.readOnlyIndices)} indices refuse writes.`, "Usually caused by a full disk. Free space, then remove the read-only block.");
  }
  const rejSearch = m.rejections.find((r) => r.pool === "search")?.count ?? 0;
  const rejWrite = m.rejections.find((r) => r.pool === "write")?.count ?? 0;
  if (rejSearch > 0) add("critical", "Searches were rejected", `${f0(rejSearch)} searches refused in ${hrs}h because the queue was full.`, "The cluster could not keep up. See search time and CPU for the same period.");
  if (rejWrite > 0) add("warning", "Writes were rejected", `${f0(rejWrite)} write requests refused in ${hrs}h.`, "Senders should retry; sustained rejections mean indexing is too heavy for this server.");

  const sTime = st("searchTime.Search");
  if (sTime?.avg != null && sTime.max != null) {
    const ev = `Average ${ms(sTime.avg)} ms per shard search, peak ${ms(sTime.max)} ms.`;
    const act = "Check the search slow log for the queries responsible.";
    if (sTime.avg >= SEARCH_CRIT_MS) add("critical", "Searches are slow", ev, act);
    else if (sTime.avg >= SEARCH_WARN_MS) add("warning", "Search time elevated", ev, act);
  }
  const queue = st("searchQueue.Search");
  if (queue?.max != null && queue.max >= QUEUE_WARN) {
    add("warning", "Searches are queuing", `Up to ${f0(queue.max)} searches waited in the queue.`, "Searches arrive faster than they finish.");
  }
  if (x.throttled === 1) {
    add("warning", "Indexing was throttled", "Elasticsearch slowed down writes during the window.", "Merging cannot keep up with indexing; usually a disk speed limit.");
  }
  const open = st("openFiles.Open files")?.last;
  if (open != null && m.maxOpenFiles && open / m.maxOpenFiles >= OPEN_FILES_RATIO) {
    add("warning", "Open file limit nearly reached", `${f0(open)} of ${f0(m.maxOpenFiles)} files open.`, "Raise the limit or reduce shard count.");
  }
  const pending = st("pendingTasks.Pending");
  if (pending?.max != null && pending.max >= PENDING_WARN) {
    add("warning", "Cluster changes are backing up", `Up to ${f0(pending.max)} cluster tasks pending.`, "The master node is slow to apply changes.");
  }
  if (m.restarts != null && m.restarts > 0) {
    add("info", "Elasticsearch restarted", `${f0(m.restarts)} restart(s) in the last ${hrs}h.`, "Check whether this was planned.");
  }
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
