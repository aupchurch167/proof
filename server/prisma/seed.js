const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { updateVendorStatus } = require('../src/services/compliance');

const prisma = new PrismaClient();

function daysFromNow(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run seed against a production database');
    process.exit(1);
  }

  const seedPassword = process.env.SEED_PASSWORD || 'password123';
  const passwordHash = await bcrypt.hash(seedPassword, 12);

  const org = await prisma.organization.create({
    data: {
      name: 'Mark Allan Contracting',
      email: 'admin@markallancont.com',
      phone: '555-0100',
      address: '123 Main St, Austin, TX 78701',
      settings: {
        create: {
          minGeneralLiability: 100000000, // $1,000,000
          minWorkersComp: 50000000,       // $500,000
          minUmbrella: 100000000,         // $1,000,000
          minAutomobile: 100000000,       // $1,000,000
        },
      },
      users: {
        create: {
          email: 'admin@markallancont.com',
          passwordHash,
          firstName: 'Mark',
          lastName: 'Allan',
          role: 'ADMIN',
          emailVerified: true,
        },
      },
    },
  });

  // Create sample vendors with COIs
  const vendor1 = await prisma.vendor.create({
    data: {
      orgId: org.id,
      name: 'Acme Plumbing LLC',
      contactName: 'John Doe',
      email: 'billing@acmeplumbing.com',
      phone: '555-0101',
      address: '456 Oak St, Austin, TX 78702',
    },
  });

  const vendor2 = await prisma.vendor.create({
    data: {
      orgId: org.id,
      name: 'Spark Electric Co',
      contactName: 'Jane Smith',
      email: 'insurance@sparkelectric.com',
      phone: '555-0202',
      address: '789 Elm Ave, Austin, TX 78703',
    },
  });

  const vendor3 = await prisma.vendor.create({
    data: {
      orgId: org.id,
      name: 'Foundation First Inc',
      contactName: 'Bob Johnson',
      email: 'bob@foundationfirst.com',
      phone: '555-0303',
      address: '321 Pine Rd, Austin, TX 78704',
    },
  });

  const holder = 'Mark Allan Contracting';

  // Vendor 1: coverages split across approved rows, all comfortably in the future.
  // Status is not hardcoded — updateVendorStatus below must land on COMPLIANT.
  await prisma.coi.create({
    data: {
      vendorId: vendor1.id,
      orgId: org.id,
      coverageType: 'GENERAL_LIABILITY',
      pdfPath: '',
      status: 'APPROVED',
      glPolicyNumber: 'GL-2026-001',
      glCoverageAmount: 200000000, // $2,000,000
      glExpirationDate: daysFromNow(180),
      certificateHolderName: holder,
      agentName: 'Sarah Parker',
      agentEmail: 'sarah@insuranceco.com',
      agentPhone: '555-0500',
      insuranceCompany: 'State Farm',
    },
  });

  await prisma.coi.create({
    data: {
      vendorId: vendor1.id,
      orgId: org.id,
      coverageType: 'WORKERS_COMP',
      pdfPath: '',
      status: 'APPROVED',
      wcPolicyNumber: 'WC-2026-001',
      wcCoverageAmount: 100000000, // $1,000,000
      wcExpirationDate: daysFromNow(240),
      certificateHolderName: holder,
      agentName: 'Sarah Parker',
      agentEmail: 'sarah@insuranceco.com',
      agentPhone: '555-0500',
      insuranceCompany: 'State Farm',
    },
  });

  await prisma.coi.create({
    data: {
      vendorId: vendor1.id,
      orgId: org.id,
      coverageType: 'AUTO',
      pdfPath: '',
      status: 'APPROVED',
      autoPolicyNumber: 'AUTO-2026-001',
      autoCoverageAmount: 100000000, // $1,000,000
      autoExpirationDate: daysFromNow(300),
      certificateHolderName: holder,
      agentName: 'Sarah Parker',
      agentEmail: 'sarah@insuranceco.com',
      agentPhone: '555-0500',
      insuranceCompany: 'State Farm',
    },
  });

  await prisma.coi.create({
    data: {
      vendorId: vendor1.id,
      orgId: org.id,
      coverageType: 'UMBRELLA',
      pdfPath: '',
      status: 'APPROVED',
      umbPolicyNumber: 'UMB-2026-001',
      umbCoverageAmount: 200000000,
      umbExpirationDate: daysFromNow(200),
      certificateHolderName: holder,
      agentName: 'Sarah Parker',
      agentEmail: 'sarah@insuranceco.com',
      agentPhone: '555-0500',
      insuranceCompany: 'State Farm',
    },
  });

  // Vendor 2: Multi-coverage COI (ACORD 25 style, pending review)
  await prisma.coi.create({
    data: {
      vendorId: vendor2.id,
      orgId: org.id,
      coverageType: 'OTHER',
      pdfPath: '',
      status: 'PENDING_REVIEW',
      glPolicyNumber: 'CGL-5500',
      glCoverageAmount: 100000000,
      glExpirationDate: daysFromNow(400),
      wcPolicyNumber: 'WC-5500',
      wcCoverageAmount: 50000000,
      wcExpirationDate: daysFromNow(400),
      umbPolicyNumber: 'UMB-5500',
      umbCoverageAmount: 200000000,
      umbExpirationDate: daysFromNow(400),
      autoPolicyNumber: 'AU-5500',
      autoCoverageAmount: 100000000,
      autoExpirationDate: daysFromNow(400),
      agentName: 'Mike Torres',
      agentEmail: 'mike@allcoverage.com',
      agentPhone: '555-0600',
      insuranceCompany: 'Nationwide',
    },
  });

  // Vendor 3: every required line is on file; general liability expires in 14 days.
  await prisma.coi.create({
    data: {
      vendorId: vendor3.id,
      orgId: org.id,
      coverageType: 'GENERAL_LIABILITY',
      pdfPath: '',
      status: 'APPROVED',
      certificateHolderName: holder,
      glPolicyNumber: 'GL-9900',
      glCoverageAmount: 100000000,
      glExpirationDate: daysFromNow(14),
      wcPolicyNumber: 'WC-9900',
      wcCoverageAmount: 100000000,
      wcExpirationDate: daysFromNow(200),
      autoPolicyNumber: 'AUTO-9900',
      autoCoverageAmount: 100000000,
      autoExpirationDate: daysFromNow(200),
      umbPolicyNumber: 'UMB-9900',
      umbCoverageAmount: 200000000,
      umbExpirationDate: daysFromNow(200),
      agentName: 'Lisa Chen',
      agentEmail: 'lisa@protectins.com',
      agentPhone: '555-0700',
      insuranceCompany: 'Progressive',
    },
  });

  for (const vendor of [vendor1, vendor2, vendor3]) {
    await updateVendorStatus(prisma, vendor.id, org.id);
  }

  console.log(`Seed complete. Login: admin@markallancont.com / ${seedPassword}`);
  console.log(`Created ${3} vendors with ${6} COIs across different coverage types`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
