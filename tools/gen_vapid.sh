#!/bin/bash
# Генерация VAPID-ключей для web-push уведомлений.
# Публичный ключ → клиенту, приватный → в переменную окружения VAPID_PRIVATE_KEY.
# Требует: npm install web-push (один раз)
cd "$(dirname "$0")/../client"
node -e "
const wp = require('web-push');
const keys = wp.generateVAPIDKeys();
console.log('Public:  ' + keys.publicKey);
console.log('Private: ' + keys.privateKey);
console.log('');
console.log('Добавь в systemd: Environment=VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('Публичный ключ уже в sw.js (или замени appServerKey)');
"
