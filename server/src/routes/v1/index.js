const express = require('express');
const { apiAuth } = require('../../middleware/apiAuth');
const vendors = require('./vendors');

// Org-scoped v1 API router. Mounted at /api/v1/orgs/:orgSlug so every route is
// authenticated and bound to a single organization.
const router = express.Router({ mergeParams: true });

router.use(apiAuth);
router.use('/vendors', vendors);

module.exports = router;
