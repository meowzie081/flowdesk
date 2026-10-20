import webpush from 'web-push';
import {randomBytes} from 'node:crypto';
// Run locally, once. Never commit this output or paste it into chats.
const keys = webpush.generateVAPIDKeys();
console.log('# Сохраните в .env и в серверных переменных хостинга. Не публикуйте этот вывод.');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:admin@example.com\nNOTIFICATION_CRON_SECRET=${randomBytes(32).toString('base64url')}`);
