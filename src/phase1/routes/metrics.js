/**
 * phase1/routes/metrics.js — مقاييس للمراقبة (مرحلة 1 — للـ Prometheus/Grafana)
 */

async function metricsRoutes(fastify, opts) {
  const start = Date.now();
  let requests = 0;
  fastify.addHook('onResponse', async () => { requests++; });

  fastify.get('/metrics', async (req, reply) => {
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    const uptime = Math.floor((Date.now() - start) / 1000);
    const mem = process.memoryUsage();
    return [
      '# HELP mss_uptime_seconds Uptime',
      '# TYPE mss_uptime_seconds counter',
      `mss_uptime_seconds ${uptime}`,
      '# HELP mss_requests_total Total requests',
      '# TYPE mss_requests_total counter',
      `mss_requests_total ${requests}`,
      '# HELP mss_memory_heap_bytes Heap used',
      '# TYPE mss_memory_heap_bytes gauge',
      `mss_memory_heap_bytes ${Math.round(mem.heapUsed)}`,
      '# HELP mss_memory_rss_bytes RSS',
      '# TYPE mss_memory_rss_bytes gauge',
      `mss_memory_rss_bytes ${Math.round(mem.rss)}`,
    ].join('\n') + '\n';
  });
}

module.exports = { metricsRoutes };
