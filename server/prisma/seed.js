const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('password123', 12);

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
      coiStatus: 'COMPLIANT',
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
      coiStatus: 'PENDING',
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
      coiStatus: 'EXPIRING_SOON',
    },
  });

  // Vendor 1: GL COI (compliant, expires in 6 months)
  await prisma.coi.create({
    data: {
      vendorId: vendor1.id,
      orgId: org.id,
      coverageType: 'GENERAL_LIABILITY',
      pdfPath: '',
      status: 'APPROVED',
      glPolicyNumber: 'GL-2026-001',
      glCoverageAmount: 200000000, // $2,000,000
      glExpirationDate: new Date('2026-09-15'),
      agentName: 'Sarah Parker',
      agentEmail: 'sarah@insuranceco.com',
      agentPhone: '555-0500',
      insuranceCompany: 'State Farm',
    },
  });

  // Vendor 1: WC COI (compliant, expires in 8 months)
  await prisma.coi.create({
    data: {
      vendorId: vendor1.id,
      orgId: org.id,
      coverageType: 'WORKERS_COMP',
      pdfPath: '',
      status: 'APPROVED',
      wcPolicyNumber: 'WC-2026-001',
      wcCoverageAmount: 100000000, // $1,000,000
      wcExpirationDate: new Date('2026-11-30'),
      agentName: 'Sarah Parker',
      agentEmail: 'sarah@insuranceco.com',
      agentPhone: '555-0500',
      insuranceCompany: 'State Farm',
    },
  });

  // Vendor 1: Auto COI
  await prisma.coi.create({
    data: {
      vendorId: vendor1.id,
      orgId: org.id,
      coverageType: 'AUTO',
      pdfPath: '',
      status: 'APPROVED',
      autoPolicyNumber: 'AUTO-2026-001',
      autoCoverageAmount: 100000000, // $1,000,000
      autoExpirationDate: new Date('2026-12-31'),
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
      glExpirationDate: new Date('2027-01-15'),
      wcPolicyNumber: 'WC-5500',
      wcCoverageAmount: 50000000,
      wcExpirationDate: new Date('2027-01-15'),
      umbPolicyNumber: 'UMB-5500',
      umbCoverageAmount: 200000000,
      umbExpirationDate: new Date('2027-01-15'),
      autoPolicyNumber: 'AU-5500',
      autoCoverageAmount: 100000000,
      autoExpirationDate: new Date('2027-01-15'),
      agentName: 'Mike Torres',
      agentEmail: 'mike@allcoverage.com',
      agentPhone: '555-0600',
      insuranceCompany: 'Nationwide',
    },
  });

  // Vendor 3: GL COI expiring soon (14 days)
  const soon = new Date();
  soon.setDate(soon.getDate() + 14);
  await prisma.coi.create({
    data: {
      vendorId: vendor3.id,
      orgId: org.id,
      coverageType: 'GENERAL_LIABILITY',
      pdfPath: '',
      status: 'APPROVED',
      glPolicyNumber: 'GL-9900',
      glCoverageAmount: 100000000,
      glExpirationDate: soon,
      agentName: 'Lisa Chen',
      agentEmail: 'lisa@protectins.com',
      agentPhone: '555-0700',
      insuranceCompany: 'Progressive',
    },
  });

  // Vendor 3: Umbrella COI (already expired)
  const expired = new Date();
  expired.setDate(expired.getDate() - 30);
  await prisma.coi.create({
    data: {
      vendorId: vendor3.id,
      orgId: org.id,
      coverageType: 'UMBRELLA',
      pdfPath: '',
      status: 'EXPIRED',
      umbPolicyNumber: 'UMB-9900',
      umbCoverageAmount: 200000000,
      umbExpirationDate: expired,
      agentName: 'Lisa Chen',
      agentEmail: 'lisa@protectins.com',
      agentPhone: '555-0700',
      insuranceCompany: 'Progressive',
    },
  });

  console.log('Seed complete. Login: admin@markallancont.com / password123');
  console.log(`Created ${3} vendors with ${6} COIs across different coverage types`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
