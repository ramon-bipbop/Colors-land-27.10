import { Settings } from './config.js';
import { fileURLToPath } from 'node:url';
const settings = new Settings(fileURLToPath(new URL('../config/settings.json',import.meta.url)));
const error = settings.readiness();
if (error) { console.log(`Продажи закрыты: ${error}`); process.exitCode=1; }
else console.log('Настройки заполнены. Проверьте .env и реальную выдачу/отключение в панели перед запуском.');
