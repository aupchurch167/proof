const { z } = require('zod');
const { emailFieldError } = require('./emailAddress');
const { phoneFieldError, addressFieldError } = require('./vendorContact');

const PRIVILEGED_BODY_KEYS = ['plan', 'role', 'orgId'];
const VENDOR_NAME_MAX = 200;
const ORG_NAME_MAX = 200;

const vendorName = z.string()
  .trim()
  .min(1, 'Vendor name is required')
  .max(VENDOR_NAME_MAX, `Vendor name must be ${VENDOR_NAME_MAX} characters or fewer`);

const orgName = z.string()
  .trim()
  .min(1, 'Organization name is required')
  .max(ORG_NAME_MAX, `Company name must be ${ORG_NAME_MAX} characters or fewer`);

function accountEmail() {
  return z.string().superRefine((val, ctx) => {
    const message = emailFieldError(val);
    if (message) ctx.addIssue({ code: 'custom', message });
  });
}

function optionalAccountEmail() {
  return z.string().superRefine((val, ctx) => {
    if (val == null || String(val).trim() === '') return;
    const message = emailFieldError(val);
    if (message && message !== 'Email is required') ctx.addIssue({ code: 'custom', message });
  });
}

function contactField(check, { required = false } = {}) {
  return z.union([z.string(), z.null()]).optional().superRefine((val, ctx) => {
    const message = check(val, { required });
    if (message) ctx.addIssue({ code: 'custom', message });
  });
}

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const centsAmount = z.number().int().min(0).max(2147483647);
const dayListInput = z.array(z.union([z.number(), z.string()]));

const schemas = {
  login: z.object({
    email: accountEmail(),
    password: z.string().min(1, 'Password is required'),
  }),

  signup: z.object({
    orgName,
    email: accountEmail(),
    password: passwordSchema,
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    acceptTerms: z.any().refine(
      (v) => v === true || v === 'true',
      'You must accept the Terms of Service and Privacy Policy'
    ),
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
    email: optionalAccountEmail().optional(),
    currentPassword: z.string().optional(),
    newPassword: passwordSchema.optional(),
  }),

  createVendor: z.object({
    name: vendorName,
    email: accountEmail(),
    contactName: z.string().optional(),
    phone: contactField(phoneFieldError),
    address: contactField(addressFieldError),
    trade: z.string().optional(),
    additionalEmails: z.array(accountEmail()).optional(),
  }),

  updateVendor: z.object({
    name: vendorName.optional(),
    contactName: z.string().optional().nullable(),
    email: optionalAccountEmail().optional(),
    phone: contactField(phoneFieldError),
    address: contactField(addressFieldError),
    trade: z.string().optional().nullable(),
    additionalEmails: z.array(accountEmail()).optional(),
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
    acceptTerms: z.any().optional(),
  }),

  forgotPassword: z.object({
    email: accountEmail(),
  }),

  applyVendor: z.object({
    name: vendorName,
    email: accountEmail(),
    phone: contactField(phoneFieldError, { required: true }),
    address: contactField(addressFieldError, { required: true }),
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
  VENDOR_NAME_MAX,
  ORG_NAME_MAX,
};
