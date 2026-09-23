function isExtractLimitError(err) {
  return Boolean(err && (err.code === 'EXTRACT_DAILY_CAP' || err.code === 'EXTRACT_BYTE_LIMIT'));
}

module.exports = { isExtractLimitError };
