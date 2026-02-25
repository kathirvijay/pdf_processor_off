const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

const serviceIcons = { gateway: '🚪', template: '📄', pdf: '📑', csv: '📊' };
const serviceNames = { gateway: 'Gateway', template: 'Template', pdf: 'PDF', csv: 'CSV' };

class StartupLogger {
  static logServiceStarted(serviceName, port) {
    const icon = serviceIcons[serviceName] || '✅';
    const name = serviceNames[serviceName] || serviceName.charAt(0).toUpperCase() + serviceName.slice(1);
    console.log(`${colors.green}${colors.bright}${icon} ${name} Service${colors.reset} ${colors.cyan}→${colors.reset} Started on port ${colors.yellow}${port}${colors.reset}`);
  }

  static logDatabaseConnected() {
    console.log(`${colors.green}${colors.bright}🗄️  PostgreSQL${colors.reset} ${colors.cyan}→${colors.reset} Connected${colors.reset}`);
  }

  static logDatabaseError(error) {
    console.log(`${colors.red}${colors.bright}❌ PostgreSQL${colors.reset} ${colors.cyan}→${colors.reset} ${colors.red}${error.message}${colors.reset}`);
  }

  static logApiTestEndpoint(port) {
    console.log(`${colors.cyan}${colors.bright}🧪 API Test${colors.reset} ${colors.cyan}→${colors.reset} http://localhost:${port}/api-test${colors.reset}`);
  }

  static logSeparator() {
    console.log(`${colors.cyan}${'─'.repeat(50)}${colors.reset}`);
  }

  static logHeader() {
    console.log('');
    console.log(`${colors.bright}${colors.magenta}╔════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.bright}${colors.magenta}║${colors.reset}  PDF Processor O Backend (reduced)${colors.bright}${colors.magenta}  ║${colors.reset}`);
    console.log(`${colors.bright}${colors.magenta}╚════════════════════════════════════════════╝${colors.reset}`);
    console.log('');
  }

  static logAllServicesStarted() {
    console.log('');
    console.log(`${colors.green}${colors.bright}✨ Services ready${colors.reset}`);
    console.log('');
  }

  static logServiceStatus(serviceName, status, port) {
    const icon = status === 'online' ? '🟢' : '🔴';
    const statusColor = status === 'online' ? colors.green : colors.red;
    const name = serviceNames[serviceName] || serviceName.charAt(0).toUpperCase() + serviceName.slice(1);
    console.log(`  ${icon} ${name} (${port}) ${statusColor}${status.toUpperCase()}${colors.reset}`);
  }
}

StartupLogger.colors = colors;
StartupLogger.serviceNames = serviceNames;
module.exports = StartupLogger;
