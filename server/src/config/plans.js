const PLAN_LIMITS = {
  FREE: {
    // Also shown on signup and Settings. Paid plans keep their own caps.
    maxVendors: 10,
    maxCois: 100,
  },
  STARTER: {
    maxVendors: 50,
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

// Shown when a create/import is refused. Existing vendors are never removed.
function vendorLimitReachedMessage(plan, limit) {
  if ((plan || 'FREE') === 'FREE') {
    return `The Free plan includes ${limit} vendors, and this account is already at that limit. Your existing vendors stay on file. Contact us when you need room for more.`;
  }
  const label = getPlanLabel(plan);
  return `You've reached the vendor limit (${limit}) for your ${label} plan. Upgrade to add more.`;
}

module.exports = {
  PLAN_LIMITS,
  PLAN_LABELS,
  getPlanLimits,
  getPlanLabel,
  vendorLimitReachedMessage,
};
