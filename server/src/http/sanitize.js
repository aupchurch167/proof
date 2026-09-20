// Strip capability secrets that must never ride on authenticated GETs.
function omitVendorSecrets(vendor) {
  if (!vendor || typeof vendor !== 'object') return vendor;
  const { uploadToken, ...rest } = vendor;
  return rest;
}

module.exports = { omitVendorSecrets };
