const { z } = require('zod');

const PRIVILEGED_BODY_KEYS = ['plan', 'role', 'orgId'];

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const centsAmount = z.number().int().min(0).max(2147483647);
const dayListInput = z.array(z.union([z.number(), z.string()]));

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
    trade: z.string().optional(),
    additionalEmails: z.array(z.string().email('Invalid email in additional emails')).optional(),
  }),

  updateVendor: z.object({
    name: z.string().min(1).optional(),
    contactName: z.string().optional().nullable(),
    email: z.string().email('Invalid email format').optional(),
    phone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    trade: z.string().optional().nullable(),
    additionalEmails: z.array(z.string().email('Invalid email in additional emails')).optional(),
    notes: z.string().optional().nullable(),
  }),

  createCoi: z.object({
    vendorId: z.string().min(1, 'Vendor ID is required'),
  }),

  updateSettings: z.object({
    minGeneralLiability: centsAmount.optional(),
    minWorkersComp: centsAmount.optional(),
    minUmbrella: centsAmount.optional(),
    minAutomobile: centsAmount.optional(),
    reminderDaysBefore: dayListInput.optional(),
    chaseDaysAfterRequest: dayListInput.optional(),
    notifyOnUpload: z.boolean().optional(),
    notifyOnExpiration: z.boolean().optional(),
    chaseNonResponders: z.boolean().optional(),
  }),

  google: z.object({
    credential: z.string().min(1, 'Google credential is required'),
    orgName: z.string().min(1).optional(),
  }),

  forgotPassword: z.object({
    email: z.string().min(1, 'Email is required').email('Invalid email format'),
  }),

  applyVendor: z.object({
    name: z.string().min(1, 'Business name is required'),
    email: z.string().email('Invalid email format'),
    phone: z.string().min(1, 'Phone is required'),
    address: z.string().min(1, 'Address is required'),
    contactName: z.string().optional(),
    trade: z.string().optional(),
    notes: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
  }),
};

function privilegedKeyError(body) {
  if (!body || typeof body !== 'object') return null;
  const found = PRIVILEGED_BODY_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(body, key));
  if (!found.length) return null;
  return `${found.join(', ')} cannot be set`;
}

function parseSchema(schema, body) {
  const privileged = privilegedKeyError(body);
  if (privileged) return { success: false, error: privileged };
  const result = schema.safeParse(body);
  if (!result.success) {
    return { success: false, error: result.error.issues.map((e) => e.message).join(', ') };
  }
  return { success: true, data: result.data };
}

function validate(schemaName) {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Request body is required (Content-Type must be application/json)' });
    }
    const schema = schemas[schemaName];
    const result = parseSchema(schema, req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    next();
  };
}

module.exports = {
  schemas,
  validate,
  passwordSchema,
  parseSchema,
  privilegedKeyError,
  PRIVILEGED_BODY_KEYS,
};
