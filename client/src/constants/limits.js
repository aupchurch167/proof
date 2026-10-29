export const VENDOR_NAME_MAX = 200;
export const ORG_NAME_MAX = 200;

export function vendorNameError(name) {
  const value = String(name ?? '').trim();
  if (!value) return 'Vendor name is required';
  if (value.length > VENDOR_NAME_MAX) {
    return `Vendor name must be ${VENDOR_NAME_MAX} characters or fewer`;
  }
  return null;
}

export function companyNameError(name) {
  const value = String(name ?? '').trim();
  if (!value) return 'Company name is required';
  if (value.length > ORG_NAME_MAX) {
    return `Company name must be ${ORG_NAME_MAX} characters or fewer`;
  }
  return null;
}
