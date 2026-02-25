require('dotenv').config();
const concurrently = require('concurrently');

const commands = [
  'npm run dev:gateway',
  'npm run dev:template',
  'npm run dev:pdf',
  'npm run dev:csv',
];

concurrently(commands, {
  killOthersOnFail: true,
  prefix: '',
  prefixColors: '',
  hide: [],
}).result.catch(() => {
  process.exit(1);
});
