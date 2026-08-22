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
    const service = new SyncService(prisma as never, mini as never);

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
    const service = new SyncService(prisma as never, mini as never);
    const assign = {
      id: '44444444-4444-4444-8444-444444444444',
      type: 'MEMBERSHIP_ASSIGN' as const,
      entityId: '55555555-5555-4555-8555-555555555555',
      occurredAt: operation.occurredAt,
      payload: { memberId: operation.entityId, planId: '77777777-7777-4777-8777-777777777777', clientPaymentId: '66666666-6666-4666-8666-666666666666' },
    };

    const response = await service.push({ operations: [operation, assign] }, user);

    expect(response.results[0].status).toBe('MERGED');
    expect(mini.createMembership).toHaveBeenCalledWith(expect.objectContaining({ memberId: canonicalId }), user);
    expect(receipts).toHaveLength(2);
  });
});
