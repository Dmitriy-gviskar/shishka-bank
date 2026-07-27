// Шишка Банк — кластерный лаунчер.
// Запуск: node server-cluster.mjs
// Форкает N воркеров (по числу ядер), каждый — полный server-pg.mjs.
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';

if (cluster.isPrimary) {
  const workers = Number(process.env.CLUSTER_WORKERS) || availableParallelism();
  console.log(`Шишка Банк master → форкаю ${workers} воркеров`);
  for (let i = 0; i < workers; i++) cluster.fork({ CLUSTER_WORKER: i + 1 });
  cluster.on('exit', (w, code) => {
    console.error(`worker ${w.id} умер (${code}), перезапускаю`);
    cluster.fork();
  });
} else {
  // Worker: запускаем основной сервер
  import('./server-pg.mjs');
}
