function isUniqueConflict(err, fieldHint) {
  if (!err || err.code !== 'P2002') return false;
  if (!fieldHint) return true;
  const target = err.meta && err.meta.target;
  if (!target) return true;
  const fields = Array.isArray(target) ? target : [String(target)];
  const needle = String(fieldHint).toLowerCase();
  return fields.some((field) => String(field).toLowerCase().includes(needle));
}

function isVendorEmailConflict(err) {
  return isUniqueConflict(err, 'email');
}

module.exports = { isUniqueConflict, isVendorEmailConflict };
