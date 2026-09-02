import { GymSubscriptionPlan, PaymentMethod, PaymentStatus, PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const subscriptionStartedAt = new Date(); const subscriptionEndsAt = new Date(subscriptionStartedAt); subscriptionEndsAt.setFullYear(subscriptionEndsAt.getFullYear() + 1);
  const gym = await prisma.gym.upsert({
    where: { slug: 'habana-fitness' },
    update: { subscriptionPlan: GymSubscriptionPlan.ANNUAL, subscriptionStartedAt, subscriptionEndsAt },
    create: { name: 'Habana Fitness', slug: 'habana-fitness', province: 'La Habana', phone: '+53 5 123 4567', subscriptionPlan: GymSubscriptionPlan.ANNUAL, subscriptionStartedAt, subscriptionEndsAt },
  });
  await prisma.user.upsert({ where: { email: 'super@gymflowmini.cu' }, update: {}, create: { email: 'super@gymflowmini.cu', passwordHash: await argon2.hash('SuperMini123!'), name: 'David', role: UserRole.SUPER_ADMIN } });
  const admin = await prisma.user.upsert({ where: { email: 'admin@habanafitness.cu' }, update: {}, create: { email: 'admin@habanafitness.cu', passwordHash: await argon2.hash('AdminMini123!'), name: 'Administrador Habana Fitness', role: UserRole.ADMIN, gymId: gym.id } });

  const monthly = await prisma.plan.upsert({ where: { gymId_name: { gymId: gym.id, name: 'Mensual' } }, update: {}, create: { gymId: gym.id, name: 'Mensual', description: 'Acceso durante 30 días', price: 3500, durationDays: 30 } });
  await prisma.plan.upsert({ where: { gymId_name: { gymId: gym.id, name: 'Quincenal' } }, update: {}, create: { gymId: gym.id, name: 'Quincenal', description: 'Acceso durante 15 días', price: 2000, durationDays: 15 } });
  await prisma.plan.upsert({ where: { gymId_name: { gymId: gym.id, name: 'Trimestral' } }, update: {}, create: { gymId: gym.id, name: 'Trimestral', description: 'Mejor precio para miembros constantes', price: 9000, durationDays: 90 } });

  const member = await prisma.member.upsert({ where: { gymId_ci: { gymId: gym.id, ci: '90010112345' } }, update: {}, create: { gymId: gym.id, ci: '90010112345', firstName: 'Alejandro', lastName: 'Pérez', phone: '+53 5 555 0192', address: 'Centro Habana' } });
  const startDate = new Date(); const endDate = new Date(); endDate.setDate(endDate.getDate() + 30);
  const membership = await prisma.membership.findFirst({ where: { memberId:member.id, planId:monthly.id } })
    ?? await prisma.membership.create({ data: { memberId:member.id, planId:monthly.id, planName:monthly.name, planPrice:monthly.price, planDurationDays:monthly.durationDays, startDate, endDate } });
  const payment = await prisma.payment.upsert({ where: { membershipId:membership.id }, update: {}, create: { gymId: gym.id, memberId: member.id, membershipId:membership.id, amount: monthly.price, paidAmount: 1500, dueDate: startDate, status: PaymentStatus.PARTIAL } });
  if ((await prisma.paymentMovement.count({ where: { paymentId: payment.id } })) === 0) await prisma.paymentMovement.create({ data: { paymentId: payment.id, actorUserId: admin.id, amount: 1500, method: PaymentMethod.CASH, reference: 'Abono inicial demo' } });

  console.log('GymFlow Mini listo');
  console.log('SUPER_ADMIN: super@gymflowmini.cu / SuperMini123!');
  console.log('ADMIN: admin@habanafitness.cu / AdminMini123!');
}

main().finally(() => prisma.$disconnect());
