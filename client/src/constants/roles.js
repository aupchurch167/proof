// What each role may change. Server authorize() lists are the source of truth;
// these helpers only decide which controls to show.
//
// ADMIN    book of record, deletes, company settings, team, requirements, import
// MEMBER   day-to-day operator: add and correct vendors, request and review
//          certificates. Cannot delete vendors or certificates, import, or
//          change company settings.
// REVIEWER same certificate and vendor edits as a member, plus import.
//          Cannot delete.
// VIEWER   read only.

export function canEditVendors(role) {
  return role === 'ADMIN' || role === 'MEMBER' || role === 'REVIEWER';
}

export function canDeleteVendors(role) {
  return role === 'ADMIN';
}

export function canImport(role) {
  return role === 'ADMIN' || role === 'REVIEWER';
}
