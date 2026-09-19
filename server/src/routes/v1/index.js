const express = require('express');
const { apiAuth } = require('../../middleware/apiAuth');
const vendors = require('./vendors');
const coiRequests = require('./coiRequests');
const { errors } = require('../../http/respond');

// Org-scoped v1 API router. Mounted at /api/v1/orgs/:orgSlug so every route is
// authenticated and bound to a single organization.
const router = express.Router({ mergeParams: true });

router.use(apiAuth);
router.use('/vendors', vendors);
router.use('/coi-requests', coiRequests);

// Anything else under /api/v1 is still an API request, so it gets the API's
// error envelope. Without this, an unimplemented path falls through to the
// app's SPA fallback (GETs) or Express's default handler (everything else) and
// the caller gets HTML or an empty body with no `error.message` to report.
router.use((req, res) =>
  errors.notFound(res, 'route_not_found', `No such endpoint: ${req.method} ${req.baseUrl}${req.path}`)
);

module.exports = router;
