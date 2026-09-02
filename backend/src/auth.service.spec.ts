import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { GymSubscriptionPlan, Prisma, UserRole } from '@prisma/client';
import { AuthService } from './auth.service';

describe('AuthService self-service security', () => {
  const authUser = { id:'user-1', email:'owner@gym.cu', role:UserRole.ADMIN, gymId:'gym-1' };

  it('crea una solicitud P2P con código y la devuelve en el perfil', async () => {
    const request = { id:'request-1', code:'GF-ABC123', gymId:'gym-1', plan:GymSubscriptionPlan.MONTHLY, status:'PENDING', requestedAt:new Date(), resolvedAt:null };
    const userFindUnique = jest.fn()
      .mockResolvedValueOnce({ phone:'51234567' })
      .mockResolvedValueOnce({ id:'user-1', email:'owner@gym.cu', phone:'51234567', name:'Ana', role:UserRole.ADMIN, gymId:'gym-1', isActive:true, gym:{ id:'gym-1', name:'Gym Ana', subscriptionRequests:[request] } });
    const create = jest.fn().mockResolvedValue(request);
    const prisma = {
      user:{ findUnique:userFindUnique },
      subscriptionRequest:{ findFirst:jest.fn().mockResolvedValue(null) },
      $transaction:jest.fn(async (callback:(tx:unknown)=>unknown)=>callback({ subscriptionRequest:{ updateMany:jest.fn(), create } })),
    };
    const service = new AuthService(prisma as never,{ signAsync:jest.fn() } as never,{ sendPasswordResetCode:jest.fn() } as never);

    await expect(service.selectSubscription(authUser,{plan:GymSubscriptionPlan.MONTHLY,deviceId:'android:1234567890abcdef'})).resolves.toMatchObject({
      request:{ code:'GF-ABC123', plan:GymSubscriptionPlan.MONTHLY },
      user:{ subscriptionRequest:{ code:'GF-ABC123' }, latestSubscriptionRequest:{ code:'GF-ABC123' } },
    });
    expect(create).toHaveBeenCalledWith({data:expect.objectContaining({gymId:'gym-1',plan:GymSubscriptionPlan.MONTHLY})});
  });

  it('informa una solicitud rechazada sin mantenerla como pendiente', async () => {
    const rejected = { id:'request-1', code:'GF-ABC123', gymId:'gym-1', plan:GymSubscriptionPlan.MONTHLY, status:'REJECTED', requestedAt:new Date(), resolvedAt:new Date() };
    const prisma = {
      user:{findUnique:jest.fn().mockResolvedValue({id:'user-1',email:'owner@gym.cu',phone:'51234567',name:'Ana',role:UserRole.ADMIN,gymId:'gym-1',isActive:true,gym:{id:'gym-1',name:'Gym Ana',subscriptionRequests:[rejected]}})},
    };
    const service = new AuthService(prisma as never,{signAsync:jest.fn()} as never,{sendPasswordResetCode:jest.fn()} as never);

    await expect(service.me(authUser)).resolves.toMatchObject({
      subscriptionRequest:null,
      latestSubscriptionRequest:{code:'GF-ABC123',status:'REJECTED'},
    });
  });

  it('rechaza la prueba cuando el teléfono o dispositivo ya fue utilizado', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate trial claim',{code:'P2002',clientVersion:'5.22.0'});
    const prisma = {
      user:{ findUnique:jest.fn().mockResolvedValue({phone:'51234567'}) },
      $transaction:jest.fn(async (callback:(tx:unknown)=>unknown)=>callback({
        gym:{findUniqueOrThrow:jest.fn().mockResolvedValue({subscriptionPlan:null})},
        trialClaim:{create:jest.fn().mockRejectedValue(duplicate)},
        subscriptionRequest:{updateMany:jest.fn()},
        platformSubscription:{create:jest.fn()},
      })),
    };
    const service = new AuthService(prisma as never,{ signAsync:jest.fn() } as never,{ sendPasswordResetCode:jest.fn() } as never);

    await expect(service.selectSubscription(authUser,{plan:GymSubscriptionPlan.TRIAL,deviceId:'android:1234567890abcdef'})).rejects.toEqual(
      new ConflictException('La prueba gratuita ya fue utilizada con este teléfono o dispositivo'),
    );
  });

  it('envía un código de recuperación de seis dígitos y guarda solamente su hash', async () => {
    const create = jest.fn().mockImplementation(({data})=>({id:'reset-1',...data}));
    const sendPasswordResetCode = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      user:{findUnique:jest.fn().mockResolvedValue({id:'user-1',email:'owner@gym.cu',name:'Ana',isActive:true})},
      passwordResetCode:{findFirst:jest.fn().mockResolvedValue(null),update:jest.fn()},
      $transaction:jest.fn(async(callback:(tx:unknown)=>unknown)=>callback({passwordResetCode:{updateMany:jest.fn(),create}})),
    };
    const service = new AuthService(prisma as never,{signAsync:jest.fn()} as never,{sendPasswordResetCode} as never);
    await expect(service.forgotPassword({email:'OWNER@gym.cu'})).resolves.toHaveProperty('message');
    const sentCode = sendPasswordResetCode.mock.calls[0][0].code as string;
    expect(sentCode).toMatch(/^\d{6}$/);
    expect(create).toHaveBeenCalledWith({data:expect.objectContaining({userId:'user-1',codeHash:expect.stringMatching(/^[a-f0-9]{64}$/)})});
    expect(create.mock.calls[0][0].data.codeHash).not.toBe(sentCode);
  });

  it('informa cuando el correo no pertenece a una cuenta activa', async () => {
    const prisma = {
      user:{findUnique:jest.fn().mockResolvedValue(null)},
    };
    const sendPasswordResetCode = jest.fn();
    const service = new AuthService(prisma as never,{signAsync:jest.fn()} as never,{sendPasswordResetCode} as never);

    await expect(service.forgotPassword({email:'desconocido@gym.cu'})).rejects.toEqual(
      new NotFoundException('El correo no se encuentra registrado en el sistema'),
    );
    expect(sendPasswordResetCode).not.toHaveBeenCalled();
  });

  it('cuenta los intentos fallidos sin aceptar un código incorrecto', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      user:{findUnique:jest.fn().mockResolvedValue({id:'user-1',passwordHash:'hash',isActive:true})},
      passwordResetCode:{findFirst:jest.fn().mockResolvedValue({id:'reset-1',codeHash:'0'.repeat(64),expiresAt:new Date(Date.now()+60_000),attempts:0}),update},
    };
    const service = new AuthService(prisma as never,{signAsync:jest.fn()} as never,{sendPasswordResetCode:jest.fn()} as never);
    await expect(service.resetPassword({email:'owner@gym.cu',code:'123456',newPassword:'NuevaClave123'})).rejects.toEqual(new BadRequestException('El código es incorrecto, venció o ya fue utilizado'));
    expect(update).toHaveBeenCalledWith({where:{id:'reset-1'},data:{attempts:1}});
  });
});
