// Keep-alive pinger — prevents Render free-tier spin-down
  const TARGET = 'https://www.viba.guru/api/healthz';
  const INTERVAL_MS = 9 * 60 * 1000; // 9 minutes

  async function ping() {
    try {
      const res = await fetch(TARGET);
      console.log(new Date().toISOString(), 'ping', res.status);
    } catch (e) {
      console.error(new Date().toISOString(), 'ping failed', e.message);
    }
  }

  await ping();
  setInterval(ping, INTERVAL_MS);
  