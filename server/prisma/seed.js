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

  console.log('Seed complete. Login: admin@markallancont.com / password123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
