import { ConflictException } from '@nestjs/common';
import { SyncService } from './sync.service';

describe('SyncService', () => {
  const user = { id: 'admin-1', email: 'admin@gym.cu', role: 'ADMIN' as const, gymId: 'gym-1' };
  const operation = {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'MEMBER_CREATE' as const,
    entityId: '22222222-2222-4222-8222-222222222222',
    occurredAt: '2026-08-22T12:00:00.000Z',
    payload: { ci: '90010112345', firstName: 'Ana', lastName: 'Pérez' },
  };

  it('devuelve el recibo anterior y no repite una operación aplicada', async () => {
    const prisma = { syncReceipt: { findUnique: jest.fn().mockResolvedValue({ ...operation, gymId: 'gym-1', status: 'APPLIED', result: { id: operation.entityId }, message: null }) } };
    const mini = { createMember: jest.fn() };
    const service = new SyncService(prisma as never, mini as never, {} as never);

    const response = await service.push({ operations: [operation] }, user);

    expect(response.results[0].status).toBe('APPLIED');
    expect(mini.createMember).not.toHaveBeenCalled();
  });

  it('fusiona por CI y remapea referencias posteriores del mismo lote', async () => {
    const canonicalId = '33333333-3333-4333-8333-333333333333';
    const receipts: Array<Record<string, unknown>> = [];
    const prisma = {
      syncReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) => { receipts.push(create); return { ...create, result: create.result ?? null, message: create.message ?? null }; }),
      },
    };
    const mini = {
      createMember: jest.fn().mockRejectedValue(new ConflictException('CI duplicado')),
      findMemberByCi: jest.fn().mockResolvedValue({ id: canonicalId }),
      createMembership: jest.fn().mockResolvedValue({ id: '55555555-5555-4555-8555-555555555555', payment: { id: '66666666-6666-4666-8666-666666666666' } }),
    };
    const attendance = { checkIn: jest.fn().mockResolvedValue({ id: '99999999-9999-4999-8999-999999999999' }) };
    const service = new SyncService(prisma as never, mini as never, attendance as never);
    const assign = {
      id: '44444444-4444-4444-8444-444444444444',
      type: 'MEMBERSHIP_ASSIGN' as const,
      entityId: '55555555-5555-4555-8555-555555555555',
      occurredAt: operation.occurredAt,
      payload: { memberId: operation.entityId, planId: '77777777-7777-4777-8777-777777777777', clientPaymentId: '66666666-6666-4666-8666-666666666666' },
    };
    const checkIn = {
      id: '88888888-8888-4888-8888-888888888888',
      type: 'ATTENDANCE_CHECK_IN' as const,
      entityId: '99999999-9999-4999-8999-999999999999',
      occurredAt: operation.occurredAt,
      payload: { memberId: operation.entityId, method: 'MANUAL' },
    };

    const response = await service.push({ operations: [operation, assign, checkIn] }, user);

    expect(response.results[0].status).toBe('MERGED');
    expect(mini.createMembership).toHaveBeenCalledWith(expect.objectContaining({ memberId: canonicalId }), user);
    expect(attendance.checkIn).toHaveBeenCalledWith(expect.objectContaining({ memberId: canonicalId, clientAttendanceId: checkIn.entityId, clientMutationId: checkIn.id }), user);
    expect(receipts).toHaveLength(3);
  });

  it('sincroniza la edición offline de una membresía', async () => {
    const updateOperation = {
      id: '88888888-8888-4888-8888-888888888888',
      type: 'MEMBERSHIP_UPDATE' as const,
      entityId: '99999999-9999-4999-8999-999999999999',
      occurredAt: operation.occurredAt,
      payload: { planId: '77777777-7777-4777-8777-777777777777', status: 'ACTIVE' },
    };
    const prisma = {
      syncReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) => ({ ...create, result: create.result ?? null, message: create.message ?? null })),
      },
    };
    const mini = { updateMembership: jest.fn().mockResolvedValue({ id: updateOperation.entityId }) };
    const service = new SyncService(prisma as never, mini as never, {} as never);

    const response = await service.push({ operations: [updateOperation] }, user);

    expect(response.results[0].status).toBe('APPLIED');
    expect(mini.updateMembership).toHaveBeenCalledWith(updateOperation.entityId, expect.objectContaining(updateOperation.payload), user);
  });

  it('sincroniza la eliminación offline de una renovación programada', async () => {
    const deleteOperation = {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      type: 'MEMBERSHIP_DELETE' as const,
      entityId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      occurredAt: operation.occurredAt,
      payload: {},
    };
    const prisma = {
      syncReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) => ({ ...create, result: create.result ?? null, message: create.message ?? null })),
      },
    };
    const mini = { deleteMembership: jest.fn().mockResolvedValue({ id: deleteOperation.entityId, disposition: 'DELETED' }) };
    const service = new SyncService(prisma as never, mini as never, {} as never);

    const response = await service.push({ operations: [deleteOperation] }, user);

    expect(response.results[0].status).toBe('APPLIED');
    expect(mini.deleteMembership).toHaveBeenCalledWith(deleteOperation.entityId, user);
  });

  it('sincroniza la eliminación offline de un miembro', async () => {
    const deleteOperation = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      type: 'MEMBER_DELETE' as const,
      entityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      occurredAt: operation.occurredAt,
      payload: {},
    };
    const prisma = {
      syncReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) => ({ ...create, result: create.result ?? null, message: create.message ?? null })),
      },
    };
    const mini = { deleteMember: jest.fn().mockResolvedValue({ id: deleteOperation.entityId, disposition: 'DELETED' }) };
    const service = new SyncService(prisma as never, mini as never, {} as never);

    const response = await service.push({ operations: [deleteOperation] }, user);

    expect(response.results[0].status).toBe('APPLIED');
    expect(mini.deleteMember).toHaveBeenCalledWith(deleteOperation.entityId, user);
  });

  it('sincroniza la eliminación offline de un plan', async () => {
    const deleteOperation = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      type: 'PLAN_DELETE' as const,
      entityId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      occurredAt: operation.occurredAt,
      payload: {},
    };
    const prisma = {
      syncReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) => ({ ...create, result: create.result ?? null, message: create.message ?? null })),
      },
    };
    const mini = { deletePlan: jest.fn().mockResolvedValue({ id: deleteOperation.entityId, disposition: 'ARCHIVED' }) };
    const service = new SyncService(prisma as never, mini as never, {} as never);

    const response = await service.push({ operations: [deleteOperation] }, user);

    expect(response.results[0].status).toBe('APPLIED');
    expect(mini.deletePlan).toHaveBeenCalledWith(deleteOperation.entityId, user);
  });

  it('rechaza operaciones administrativas enviadas por una recepcionista', async () => {
    const receptionist = { ...user, role:'RECEPTIONIST' as const };
    const deleteOperation = {
      id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      type:'PLAN_DELETE' as const,
      entityId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      occurredAt:operation.occurredAt,
      payload:{},
    };
    const prisma = { syncReceipt:{
      findUnique:jest.fn().mockResolvedValue(null),
      upsert:jest.fn().mockImplementation(({ create }) => ({ ...create, result:create.result ?? null, message:create.message ?? null })),
    } };
    const mini = { deletePlan:jest.fn() };
    const service = new SyncService(prisma as never, mini as never, {} as never);
    const response = await service.push({ operations:[deleteOperation] }, receptionist);
    expect(response.results[0]).toMatchObject({ status:'REJECTED', message:'Tu rol no permite realizar esta operación' });
    expect(mini.deletePlan).not.toHaveBeenCalled();
  });
});
