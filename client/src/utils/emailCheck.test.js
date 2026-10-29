import test from 'node:test';
import assert from 'node:assert/strict';
import { emailFieldError, normalizeEmail } from './emailCheck.js';
import { vendorNameError, companyNameError } from '../constants/limits.js';
import { attentionHeadline } from './copy.js';

test('email messages match the three QA cases', () => {
  assert.equal(emailFieldError(''), 'Email is required');
  assert.equal(emailFieldError('   '), 'Email is required');
  assert.equal(emailFieldError('not-an-email'), 'Enter a valid email address');
  assert.equal(emailFieldError('a@b'), 'Enter a full email address, like name@company.com');
  assert.equal(emailFieldError(' ADA@Company.com '), null);
  assert.equal(normalizeEmail(' ADA@Company.com '), 'ada@company.com');
});

test('names have a required message and a max length', () => {
  assert.equal(vendorNameError(''), 'Vendor name is required');
  assert.equal(vendorNameError('A'.repeat(201)), 'Vendor name must be 200 characters or fewer');
  assert.equal(vendorNameError('<script>alert(1)</script>'), null);
  assert.equal(companyNameError(' '), 'Company name is required');
  assert.equal(companyNameError('A'.repeat(201)), 'Company name must be 200 characters or fewer');
});

test('the dashboard count agrees with English', () => {
  assert.equal(attentionHeadline(0), 'Nothing needs you.');
  assert.equal(attentionHeadline(1), '1 thing needs you.');
  assert.equal(attentionHeadline(2), '2 things need you.');
});
