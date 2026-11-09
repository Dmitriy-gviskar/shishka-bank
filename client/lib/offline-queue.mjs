// Durable account-scoped outbox. Web Locks serialize writes and sends across tabs.
export function createOutbox({ storage, account, aliases = [], locks, makeId = () => crypto.randomUUID() }) {
  const key = 'offv2:' + account;
  const empty = () => ({ version: 2, queue: [], snapshots: {}, completed: [], needsRefresh: false });
  function read() {
    const raw = storage.getItem(key);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.version !== 2 || !Array.isArray(data.queue) || !Array.isArray(data.completed) || !data.snapshots || typeof data.snapshots !== 'object' || data.queue.some((item) => !['/api/pack/open','/api/card/merge'].includes(item.path) || typeof item.id !== 'string' || item.body?.nonce !== item.id)) throw new Error('Повреждена очередь синхронизации. Обратитесь к ведущему.');
      // Queues imported by the previous version also contain synthesized ids.
      for (const item of data.queue) {
        item.body.protocol = 2;
        if (item.legacy && item.path === '/api/card/merge') {
          item.reviewRequired = true;
          item.error = 'Старое слияние требует проверки ведущим. Автоматический повтор остановлен.';
        }
      }
      return data;
    }
    const legacy = [];
    for (const owner of new Set([account, ...aliases])) {
      const items = JSON.parse(storage.getItem('offq:' + owner) || '[]');
      if (!Array.isArray(items)) throw new Error('Повреждена очередь синхронизации');
      for (const item of items)
        if (!item.body?.nonce || !legacy.some((x) => x.body?.nonce === item.body.nonce)) legacy.push(item);
    }
    const data = empty();
    data.queue = legacy.map((item) => {
      if (!['/api/pack/offline','/api/card/merge'].includes(item.path)) throw new Error('Неизвестная операция в старой очереди. Обратитесь к ведущему.');
      const nonce = item.body?.nonce || makeId();
      const pack = item.path === '/api/pack/offline';
      return { id: nonce, path: pack ? '/api/pack/open' : item.path,
        body: pack ? { nonce, protocol: 2 } : { ...item.body, nonce, protocol: 2 }, deferred: true,
        legacy: true, reviewRequired: !pack,
        error: !pack ? 'Старое слияние требует проверки ведущим. Автоматический повтор остановлен.' : undefined };
    });
    return data;
  }
  function write(data) { storage.setItem(key, JSON.stringify(data)); }
  async function locked(fn) {
    if (!account) throw new Error('Нужен вход в аккаунт');
    if (!locks?.request) throw new Error('Этот браузер не поддерживает надёжную офлайн-очередь. Откройте приложение в современном браузере.');
    return locks.request('shishka-outbox:' + account, fn);
  }
  async function enqueue(item, snapshots = {}) {
    return locked(() => {
      const data = read();
      if (data.needsRefresh) throw new Error('Сначала синхронизируйте данные коллекции');
      if (data.queue.some((q) => q.reviewRequired)) throw new Error('Сначала нужна проверка старого слияния ведущим');
      if (data.queue.length >= 100) throw new Error('Очередь заполнена. Сначала синхронизируйте операции.');
      if (!['/api/pack/open','/api/card/merge'].includes(item.path)) throw new Error('Неизвестная операция');
      if (data.queue.some((q) => q.body.epoch !== item.body.epoch)) throw new Error('Старая очередь требует проверки ведущим после восстановления. Она сохранена.');
      const id = item.body.nonce;
      if (data.queue.some((q) => q.id === id)) throw new Error('Операция уже в очереди');
      const prepared = typeof snapshots === 'function' ? snapshots(data) : snapshots;
      data.queue.push({ ...item, id, body: { ...item.body, protocol: 2 } });
      Object.assign(data.snapshots, prepared);
      write(data); // Quota/storage failure aborts before the action is reported as saved.
    });
  }
  async function sync(send, refresh) {
    return locked(async () => {
      let data = read();
      write(data); // Persist legacy ids before any network request.
      while (data.queue.length) {
        const item = data.queue[0];
        if (item.reviewRequired) {
          item.error = 'Старое слияние требует проверки ведущим. Автоматический повтор остановлен.';
          write(data);
          return data;
        }
        let reply;
        try { reply = await send(item); }
        catch {
          item.deferred = true;
          item.error = 'Нет связи. Операция сохранена.';
          write(data);
          return data;
        }
        if (!reply.ok || reply.body?.error || reply.body?.operation_id !== item.id) {
          item.status = reply.status;
          item.error = reply.body?.error || 'Сервер не подтвердил операцию. Она сохранена.';
          write(data);
          return data;
        }
        // Receipt and removal commit together; loss of the reply/write is safe to retry.
        data.completed.push({ id: item.id, path: item.path, result: reply.body });
        data.completed = data.completed.slice(-100);
        data.queue.shift();
        data.needsRefresh = true;
        write(data);
      }
      if (data.needsRefresh) {
        try {
          const snapshots = await refresh();
          for (const [path, body] of Object.entries(snapshots))
            storage.setItem('off:' + account + ':' + path, JSON.stringify(body));
          data.snapshots = {};
          data.needsRefresh = false;
          write(data);
        } catch { /* Keep receipts and refresh requirement across reloads. */ }
      }
      return data;
    });
  }
  return { read, enqueue, sync, key };
}
