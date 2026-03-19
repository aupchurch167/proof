const PLAN_LIMITS = {
  FREE: {
    maxVendors: 20,
    maxCois: 100,
  },
  STARTER: {
    maxVendors: 100,
    maxCois: 500,
  },
  UNLIMITED: {
    maxVendors: Infinity,
    maxCois: Infinity,
  },
};

const PLAN_LABELS = {
  FREE: 'Free',
  STARTER: 'Starter',
  UNLIMITED: 'Unlimited',
};

function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.FREE;
}

function getPlanLabel(plan) {
  return PLAN_LABELS[plan] || 'Free';
}

module.exports = { PLAN_LIMITS, PLAN_LABELS, getPlanLimits, getPlanLabel };
