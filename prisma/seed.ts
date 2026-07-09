import { PrismaClient } from "./generated/client"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import "dotenv/config";
const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaBetterSqlite3({ url: connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Start seeding...')

  // Create a User
  const user1 = await prisma.user.upsert({
    where: {email: 'seeded-user@email.com'},
    update: {},
    create: {
      email: 'seeded-user@email.com',
      name: 'Sample Seeded User'
    }
  })

  console.log({ user1 })
  console.log('Seeding finished.')
}
// You can seed other models in your db as well depending on project needs

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
