const prisma = require('../lib/prisma');
const { getPlanLimits, getPlanLabel } = require('../config/plans');

function enforcePlanLimit(resource) {
  return async (req, res, next) => {
    try {
      const org = await prisma.organization.findUnique({
        where: { id: req.user.orgId },
        select: { plan: true },
      });

      const plan = org?.plan || 'FREE';
      const limits = getPlanLimits(plan);
      const label = getPlanLabel(plan);

      if (resource === 'vendor') {
        if (limits.maxVendors === Infinity) return next();

        const count = await prisma.vendor.count({
          where: { orgId: req.user.orgId, deletedAt: null },
        });

        if (count >= limits.maxVendors) {
          return res.status(403).json({
            error: `You've reached the vendor limit (${limits.maxVendors}) for your ${label} plan. Upgrade to add more.`,
            code: 'PLAN_LIMIT_EXCEEDED',
            resource: 'vendor',
            limit: limits.maxVendors,
            current: count,
            plan,
          });
        }
      }

      if (resource === 'coi') {
        if (limits.maxCois === Infinity) return next();

        const count = await prisma.coi.count({
          where: { orgId: req.user.orgId },
        });

        if (count >= limits.maxCois) {
          return res.status(403).json({
            error: `You've reached the COI limit (${limits.maxCois}) for your ${label} plan. Upgrade to add more.`,
            code: 'PLAN_LIMIT_EXCEEDED',
            resource: 'coi',
            limit: limits.maxCois,
            current: count,
            plan,
          });
        }
      }

      next();
    } catch (err) {
      console.error('Plan limit check failed:', err);
      next();
    }
  };
}

module.exports = { enforcePlanLimit };
