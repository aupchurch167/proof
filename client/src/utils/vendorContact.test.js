import test from 'node:test';
import assert from 'node:assert/strict';
import { addressFieldError, phoneFieldError } from './vendorContact.js';
import { formatWholeDollars, parseDayCount, parseWholeDollars } from './money.js';

test('phone accepts digits, separators, and an extension, and rejects letters', () => {
  assert.equal(phoneFieldError(''), null);
  assert.equal(phoneFieldError('555-0100'), null);
  assert.equal(phoneFieldError('(555) 555-0100'), null);
  assert.equal(phoneFieldError('+1 555 555 0100'), null);
  assert.equal(phoneFieldError('555-555-0100 ext. 12'), null);
  assert.equal(phoneFieldError('555-555-0100 x12'), null);
  assert.ok(phoneFieldError('abc'));
  assert.ok(phoneFieldError('123'));
  assert.ok(phoneFieldError('555-CALL'));
  assert.equal(phoneFieldError('', { required: true }), 'Phone is required');
});

test('address sanity is light', () => {
  assert.equal(addressFieldError(''), null);
  assert.equal(addressFieldError('123 Main St'), null);
  assert.equal(addressFieldError('PO Box 12'), null);
  assert.ok(addressFieldError('abc'));
  assert.ok(addressFieldError('12345'));
  assert.equal(addressFieldError('', { required: true }), 'Address is required');
});

test('requirement amounts stay whole dollars', () => {
  assert.equal(parseWholeDollars('').empty, true);
  assert.equal(parseWholeDollars('abc').ok, false);
  assert.equal(parseWholeDollars('-5').ok, false);
  assert.equal(parseWholeDollars(-5).ok, false);
  assert.equal(parseWholeDollars('1.5').ok, false);
  assert.equal(parseWholeDollars(1.5).ok, false);
  assert.equal(parseWholeDollars('1e5').ok, false);
  assert.equal(parseWholeDollars('$1,000,000').dollars, 1000000);
  assert.equal(parseWholeDollars('1000000.00').dollars, 1000000);
  assert.equal(parseWholeDollars(2000000).dollars, 2000000);
  assert.equal(formatWholeDollars(1000000), '$1,000,000');
  assert.equal(formatWholeDollars(1000000).includes('0000001'), false);

  assert.equal(parseDayCount('30').days, 30);
  assert.equal(parseDayCount(0).days, 0);
  assert.equal(parseDayCount('-1').ok, false);
  assert.equal(parseDayCount(-1).ok, false);
  assert.equal(parseDayCount('12abc').ok, false);
  assert.equal(parseDayCount('12.5').ok, false);
  assert.equal(parseDayCount(400).ok, false);
});
