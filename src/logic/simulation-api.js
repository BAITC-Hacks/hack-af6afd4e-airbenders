(function (global) {
  async function request(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch('/api/v1' + path, { signal: controller.signal,
        ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok) {
        const detail = data.detail;
        throw new Error(typeof detail === 'string' ? detail : detail?.message || JSON.stringify(detail));
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Сервер не ответил за 45 секунд. Проверьте, что он запущен.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function wait(jobId, progress) {
    for (;;) {
      const state = await request('/runs/' + jobId);
      progress(state.message);
      if (state.status === 'failed') throw new Error(state.message);
      if (state.status === 'completed') return request('/runs/' + jobId + '/results');
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
  }
  global.SimulationAPI = { request, wait };
})(window);
