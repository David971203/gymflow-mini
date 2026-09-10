import 'reflect-metadata';
import { validate } from 'class-validator';
import { UpdateMemberDto } from '../members/members.dto';
import { SyncOperationDto } from '../sync/sync.dto';

describe('SyncOperationDto', () => {
  const operation = (entityId: string) => Object.assign(new SyncOperationDto(), {
    id:'11111111-1111-4111-8111-111111111111',
    type:'MEMBER_UPDATE',
    entityId,
    occurredAt:'2026-09-02T12:00:00.000Z',
    payload:{ firstName:'Alejandro' },
  });

  it('acepta IDs UUID de entidades nuevas', async () => {
    const errors = await validate(operation('22222222-2222-4222-8222-222222222222'));
    expect(errors.find(error => error.property === 'entityId')).toBeUndefined();
  });

  it('acepta IDs históricos no UUID creados por seeds anteriores', async () => {
    const errors = await validate(operation('demo-member-gym-1'));
    expect(errors.find(error => error.property === 'entityId')).toBeUndefined();
  });

  it('rechaza un ID de entidad vacío', async () => {
    const errors = await validate(operation(''));
    expect(errors.find(error => error.property === 'entityId')?.constraints).toHaveProperty('minLength');
  });
});

describe('UpdateMemberDto', () => {
  it('rechaza editar manualmente el estado derivado del miembro', async () => {
    const dto = Object.assign(new UpdateMemberDto(), { firstName:'Ana', status:'INACTIVE' });
    const errors = await validate(dto, { whitelist:true, forbidNonWhitelisted:true });
    expect(errors.find(error => error.property === 'status')?.constraints).toHaveProperty('whitelistValidation');
  });
});
