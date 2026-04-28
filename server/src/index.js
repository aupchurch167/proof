const prisma = require('./lib/prisma');
const app = require('./app');
const { startExpirationCron, startTokenRefreshCron, startWeeklySummaryCron } = require('./services/cron');

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  console.log(`Proof server running on port ${PORT}`);
  startExpirationCron(prisma);
  startTokenRefreshCron(prisma);
  startWeeklySummaryCron(prisma);
});

function shutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    console.log('HTTP server closed');
    await prisma.$disconnect();
    console.log('Database connections closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
