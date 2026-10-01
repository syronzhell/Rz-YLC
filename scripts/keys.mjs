import {randomBytes} from 'node:crypto';
console.log('CMS_PASSWORD='+randomBytes(18).toString('base64url'));
console.log('SESSION_SECRET='+randomBytes(32).toString('hex'));
console.log('TOKEN_ENCRYPTION_KEY='+randomBytes(32).toString('hex'));
