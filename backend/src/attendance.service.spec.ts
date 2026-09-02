import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AttendanceMethod, MembershipStatus } from '@prisma/client';
import { AttendanceService } from './attendance.service';

describe('AttendanceService', () => {
  const user = { id: 'admin-1', email: 'admin@gym.cu', role: 'ADMIN' as const, gymId: 'gym-1' };
  const member = { id: 'legacy-member-1', gymId: 'gym-1', firstName: 'Ana', lastName: 'Pérez', status: 'ACTIVE', qrCode: '49a8e8a0-1c8f-49bd-bca9-21d8b76b452f' };

  it('registra una entrada manual para un miembro con membresía vigente', async () => {
    const created = { id: 'attendance-1', memberId: member.id, checkInAt: new Date(), checkOutAt: null, method: AttendanceMethod.MANUAL, member };
    const create = jest.fn().mockResolvedValue(created);
    const prisma = {
      member: { findFirst: jest.fn().mockResolvedValue(member) },
      membership: { findFirst: jest.fn().mockResolvedValue({ id: 'membership-1', status: MembershipStatus.ACTIVE }) },
      attendance: { findFirst: jest.fn().mockResolvedValue(null), create },
    };
    const service = new AttendanceService(prisma as never);

    await expect(service.checkIn({ memberId: member.id }, user)).resolves.toBe(created);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gymId: 'gym-1', memberId: member.id, method: AttendanceMethod.MANUAL }),
    }));
  });

  it('rechaza la entrada cuando no existe una membresía vigente', async () => {
    const prisma = {
      member: { findFirst: jest.fn().mockResolvedValue(member) },
      membership: { findFirst: jest.fn().mockResolvedValue(null) },
      attendance: { findFirst: jest.fn(), create: jest.fn() },
    };
    const service = new AttendanceService(prisma as never);

    await expect(service.checkIn({ memberId: member.id }, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.attendance.create).not.toHaveBeenCalled();
  });

  it('impide dos entradas abiertas para el mismo miembro', async () => {
    const prisma = {
      member: { findFirst: jest.fn().mockResolvedValue(member) },
      membership: { findFirst: jest.fn().mockResolvedValue({ id: 'membership-1' }) },
      attendance: { findFirst: jest.fn().mockResolvedValue({ id: 'attendance-open' }), create: jest.fn() },
    };
    const service = new AttendanceService(prisma as never);

    await expect(service.checkIn({ memberId: member.id }, user)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.attendance.create).not.toHaveBeenCalled();
  });

  it('registra la salida únicamente en el gimnasio autenticado', async () => {
    const checkInAt = new Date(Date.now() - 60_000);
    const attendance = { id: 'attendance-1', gymId: 'gym-1', checkInAt, checkOutAt: null, member };
    const updated = { ...attendance, checkOutAt: new Date() };
    const update = jest.fn().mockResolvedValue(updated);
    const prisma = { attendance: { findFirst: jest.fn().mockResolvedValue(attendance), update } };
    const service = new AttendanceService(prisma as never);

    await expect(service.checkOut(attendance.id, {}, user)).resolves.toBe(updated);
    expect(prisma.attendance.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: attendance.id, gymId: 'gym-1' } }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: attendance.id } }));
  });

  it('no revela asistencias pertenecientes a otro gimnasio', async () => {
    const prisma = { attendance: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new AttendanceService(prisma as never);

    await expect(service.checkOut('attendance-other', {}, user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mantiene en el snapshot las entradas abiertas aunque sean anteriores a 30 días', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new AttendanceService({ attendance: { findMany } } as never);

    await service.snapshot(user);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ gymId: 'gym-1', OR: expect.arrayContaining([{ checkOutAt: null }]) }),
    }));
  });
});
