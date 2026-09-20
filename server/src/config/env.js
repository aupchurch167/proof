const { z } = require('zod');

const PLACEHOLDERS = new Set([
  'your-jwt-secret',
  'your-refresh-secret',
  'your-jwt-secret-at-least-32-characters',
  'your-refresh-secret-at-least-32-chars',
]);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_URL: z.string().min(1, 'APP_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  NODE_ENV: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
}).superRefine((val, ctx) => {
  if (PLACEHOLDERS.has(val.JWT_SECRET)) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message: 'JWT_SECRET must not be the example placeholder',
    });
  }
  if (PLACEHOLDERS.has(val.JWT_REFRESH_SECRET)) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_REFRESH_SECRET'],
      message: 'JWT_REFRESH_SECRET must not be the example placeholder',
    });
  }
  if (val.NODE_ENV === 'production' && !val.RESEND_WEBHOOK_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['RESEND_WEBHOOK_SECRET'],
      message: 'RESEND_WEBHOOK_SECRET is required in production',
    });
  }
});

function validateEnv(env = process.env) {
  const result = envSchema.safeParse({
    DATABASE_URL: env.DATABASE_URL,
    APP_URL: env.APP_URL,
    JWT_SECRET: env.JWT_SECRET,
    JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET,
    NODE_ENV: env.NODE_ENV,
    RESEND_WEBHOOK_SECRET: env.RESEND_WEBHOOK_SECRET,
  });

  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const field = issue.path.filter(Boolean).join('.') || 'env';
      return issue.message.includes(field) ? issue.message : `${field}: ${issue.message}`;
    });
    const err = new Error(`Invalid environment:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    err.errors = errors;
    throw err;
  }
  return result.data;
}

module.exports = { validateEnv };
