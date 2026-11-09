// Шишка Банк — кластерный лаунчер.
// Запуск: node server-cluster.mjs
// Форкает N воркеров (по числу ядер), каждый — полный server-pg.mjs.
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';

if (cluster.isPrimary) {
  const workers = Number(process.env.CLUSTER_WORKERS) || availableParallelism();
  console.log(`Шишка Банк master → форкаю ${workers} воркеров`);
  for (let i = 0; i < workers; i++) cluster.fork({ CLUSTER_WORKER: i + 1 });
  let stopping = false;
  cluster.on('exit', (w, code) => {
    if (stopping) return;
    if (code === 78) {
      stopping = true;
      console.error('Миграция не выполнена: останавливаю кластер');
      process.exitCode = 78;
      for (const worker of Object.values(cluster.workers)) worker?.kill();
      return;
    }
    console.error(`worker ${w.id} умер (${code}), перезапускаю`);
    cluster.fork();
  });
  // APK WebSocket пуши сидят на разных воркерах — рассылаем всем, кроме отправителя
  cluster.on('message', (worker, msg) => {
    if (!msg || msg.type !== 'apk-push') return;
    for (const id in cluster.workers) {
      const w = cluster.workers[id];
      if (w && w !== worker) {
        try { w.send(msg); } catch {}
      }
    }
  });
} else {
  // Worker: запускаем основной сервер
  await import('./server-pg.mjs');
}
