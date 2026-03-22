const { z } = require('zod');

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const schemas = {
  login: z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required'),
  }),

  signup: z.object({
    orgName: z.string().min(1, 'Organization name is required'),
    email: z.string().email('Invalid email format'),
    password: passwordSchema,
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
  }),

  acceptInvite: z.object({
    token: z.string().min(1, 'Token is required'),
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    password: passwordSchema,
  }),

  updateProfile: z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    email: z.string().email('Invalid email format').optional(),
    currentPassword: z.string().optional(),
    newPassword: passwordSchema.optional(),
  }),

  createVendor: z.object({
    name: z.string().min(1, 'Vendor name is required'),
    email: z.string().email('Invalid email format'),
    contactName: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
  }),

  createCoi: z.object({
    vendorId: z.string().min(1, 'Vendor ID is required'),
  }),
};

function validate(schemaName) {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Request body is required (Content-Type must be application/json)' });
    }
    const schema = schemas[schemaName];
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues.map(e => e.message).join(', ');
      return res.status(400).json({ error: message });
    }
    next();
  };
}

module.exports = { schemas, validate, passwordSchema };
