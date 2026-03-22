const { PrismaClient } = require('@prisma/client');
const app = require('./app');
const { startExpirationCron, startTokenRefreshCron, startWeeklySummaryCron } = require('./services/cron');

const prisma = new PrismaClient();
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Proof server running on port ${PORT}`);
  startExpirationCron(prisma);
  startTokenRefreshCron(prisma);
  startWeeklySummaryCron(prisma);
});

module.exports = app;
