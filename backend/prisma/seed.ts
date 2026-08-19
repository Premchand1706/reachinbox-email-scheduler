import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create a default test user
  const user = await prisma.user.upsert({
    where: { email: 'intern@reachinbox.ai' },
    update: {},
    create: {
      email: 'intern@reachinbox.ai',
      name: 'ReachInbox Intern',
      avatar: 'https://lh3.googleusercontent.com/a/default-user',
    },
  });

  console.log(`User created/found: ${user.email} (${user.id})`);

  // Create default senders for this user
  const sendersData = [
    { email: 'john.doe@reachinbox.ai', name: 'John Doe (Sales)' },
    { email: 'outreach@reachinbox.ai', name: 'ReachInbox Outreach' },
    { email: 'support@reachinbox.ai', name: 'ReachInbox Support' },
  ];

  for (const sender of sendersData) {
    await prisma.sender.upsert({
      where: { email: sender.email },
      update: { userId: user.id },
      create: {
        email: sender.email,
        name: sender.name,
        userId: user.id,
      },
    });
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
