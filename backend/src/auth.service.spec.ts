import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { GymSubscriptionPlan, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHmac } from 'crypto';
import { AuthService } from './auth.service';

describe('AuthService self-service security', () => {
  const authUser = { id:'user-1', email:'owner@gym.cu', role:UserRole.ADMIN, gymId:'gym-1' };

  it('crea la cuenta pendiente y envía solamente el código cuando producción exige verificar el correo', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const createVerification = jest.fn().mockImplementation(({data})=>({id:'verification-1',...data}));
    const createUser = jest.fn().mockResolvedValue({id:'user-1',email:'owner@gmail.com',name:'Ana',gymId:'gym-1'});
    const sendEmailVerificationCode = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      emailVerificationCode:{findFirst:jest.fn().mockResolvedValue(null),update:jest.fn()},
      $transaction:jest.fn(async(callback:(tx:unknown)=>unknown)=>callback({
        gym:{create:jest.fn().mockResolvedValue({id:'gym-1'})},
        user:{create:createUser},
        emailVerificationCode:{updateMany:jest.fn(),create:createVerification},
      })),
    };
    const service = new AuthService(prisma as never,{signAsync:jest.fn()} as never,{sendEmailVerificationCode} as never);
    try {
      await expect(service.register({ownerName:'Ana',gymName:'Gym Ana',phone:'51234567',email:'OWNER@gmail.com',password:'ClaveSegura123',deviceId:'android:1234567890'})).resolves.toMatchObject({verificationRequired:true,email:'owner@gmail.com'});
      expect(createUser).toHaveBeenCalledWith({data:expect.objectContaining({email:'owner@gmail.com',emailVerifiedAt:null})});
      const sentCode = sendEmailVerificationCode.mock.calls[0][0].code as string;
      expect(sentCode).toMatch(/^\d{6}$/);
      expect(createVerification).toHaveBeenCalledWith({data:expect.objectContaining({codeHash:expect.stringMatching(/^[a-f0-9]{64}$/)})});
      expect(createVerification.mock.calls[0][0].data.codeHash).not.toBe(sentCode);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('mantiene el autorregistro directo en desarrollo cuando la verificación está desactivada', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousVerification = process.env.EMAIL_VERIFICATION_REQUIRED;
    process.env.NODE_ENV = 'development';
    delete process.env.EMAIL_VERIFICATION_REQUIRED;
    const createUser = jest.fn().mockResolvedValue({id:'user-1',email:'owner@gmail.com',name:'Ana',gymId:'gym-1'});
    const sendEmailVerificationCode = jest.fn();
    const prisma = {$transaction:jest.fn(async(callback:(tx:unknown)=>unknown)=>callback({gym:{create:jest.fn().mockResolvedValue({id:'gym-1'})},user:{create:createUser}}))};
    const service = new AuthService(prisma as never,{signAsync:jest.fn()} as never,{sendEmailVerificationCode} as never);
    jest.spyOn(service as never,'session').mockResolvedValue({accessToken:'jwt',user:{id:'user-1'}} as never);
    try {
      await expect(service.register({ownerName:'Ana',gymName:'Gym Ana',phone:'51234567',email:'owner@gmail.com',password:'ClaveSegura123',deviceId:'android:1234567890'})).resolves.toMatchObject({accessToken:'jwt'});
      expect(createUser).toHaveBeenCalledWith({data:expect.objectContaining({emailVerifiedAt:expect.any(Date)})});
      expect(sendEmailVerificationCode).not.toHaveBeenCalled();
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
      if (previousVerification === undefined) delete process.env.EMAIL_VERIFICATION_REQUIRED; else process.env.EMAIL_VERIFICATION_REQUIRED = previousVerification;
    }
  });

  it('bloquea el login por contraseña de una cuenta que aún no verificó su correo', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const passwordHash = await argon2.hash('ClaveSegura123');
    const prisma = {user:{findUnique:jest.fn().mockResolvedValue({id:'user-1',email:'owner@gmail.com',passwordHash,isActive:true,emailVerifiedAt:null,role:UserRole.ADMIN,gym:{isActive:true}})}};
    const service = new AuthService(prisma as never,{signAsync:jest.fn()} as never,{} as never);
    try {
      await expect(service.login({email:'owner@gmail.com',password:'ClaveSegura123'})).rejects.toEqual(
        new ForbiddenException({code:'EMAIL_NOT_VERIFIED',message:'Debes verificar tu correo antes de iniciar sesión'}),
      );
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('activa la cuenta con un código válido de un solo uso y crea la sesión', async () => {
    const code = '123456';
    const codeHash = createHmac('sha256',process.env.JWT_SECRET??'local').update(`verify-email:user-1:${code}`).digest('hex');
    const updateUser = jest.fn();
    const consumeCodes = jest.fn();
    const prisma = {
      user:{findUnique:jest.fn().mockResolvedValue({id:'user-1',isActive:true,emailVerifiedAt:null})},
      emailVerificationCode:{findFirst:jest.fn().mockResolvedValue({id:'verification-1',codeHash,expiresAt:new Date(Date.now()+60_000),attempts:0}),update:jest.fn()},
      $transaction:jest.fn(async(callback:(tx:unknown)=>unknown)=>callback({user:{update:updateUser},emailVerificationCode:{updateMany:consumeCodes}})),
    };
    const service = new AuthService(prisma as never,{signAsync:jest.fn()} as never,{} as never);
    jest.spyOn(service as never,'session').mockResolvedValue({accessToken:'jwt',user:{id:'user-1'}} as never);

    await expect(service.verifyEmail({email:'owner@gmail.com',code})).resolves.toMatchObject({accessToken:'jwt'});
    expect(updateUser).toHaveBeenCalledWith({where:{id:'user-1'},data:{emailVerifiedAt:expect.any(Date)}});
    expect(consumeCodes).toHaveBeenCalledWith({where:{userId:'user-1',usedAt:null},data:{usedAt:expect.any(Date)}});
  });

  it('inicia sesión con Google solamente si el administrador ya existe', async () => {
    const existing = { id:'user-1',email:'owner@gmail.com',emailVerifiedAt:null,isActive:true,role:UserRole.ADMIN,gym:{isActive:true} };
    const update = jest.fn().mockResolvedValue({...existing,emailVerifiedAt:new Date()});
    const prisma = { user:{findUnique:jest.fn().mockResolvedValue(existing),update} };
    const googleIdentity = { verifiedEmail:jest.fn().mockResolvedValue('owner@gmail.com') };
    const service = new AuthService(prisma as never,{signAsync:jest.fn()} as never,{sendPasswordResetCode:jest.fn()} as never,googleIdentity as never);
    jest.spyOn(service as never,'session').mockResolvedValue({accessToken:'jwt',user:existing} as never);

    await expect(service.googleLogin({idToken:'token-valido'.repeat(12)})).resolves.toMatchObject({accessToken:'jwt'});
    expect(prisma.user.findUnique).toHaveBeenCalledWith({where:{email:'owner@gmail.com'},include:{gym:true}});
    expect(update).toHaveBeenCalledWith({where:{id:'user-1'},data:{emailVerifiedAt:expect.any(Date)}});
  });

  it('no crea una cuenta cuando el correo autenticado con Google no existe', async () => {
    const prisma = { user:{findUnique:jest.fn().mockResolvedValue(null)} };
    const googleIdentity = { verifiedEmail:jest.fn().mockResolvedValue('nuevo@gmail.com') };
    const service = new AuthService(prisma as never,{signAsync:jest.fn()} as never,{sendPasswordResetCode:jest.fn()} as never,googleIdentity as never);

    await expect(service.googleLogin({idToken:'token-valido'.repeat(12)})).rejects.toEqual(
      new UnauthorizedException('No existe una cuenta de GymFlow con este correo. Crea tu cuenta primero'),
    );
    expect(Object.keys(prisma)).toEqual(['user']);
  });

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
    const prisma = {
      user:{ findUnique:jest.fn().mockResolvedValue({phone:'51234567'}) },
      trialClaim:{findFirst:jest.fn().mockResolvedValue({id:'claim-1'})},
    };
    const service = new AuthService(prisma as never,{ signAsync:jest.fn() } as never,{ sendPasswordResetCode:jest.fn() } as never);

    await expect(service.selectSubscription(authUser,{plan:GymSubscriptionPlan.TRIAL,deviceId:'android:1234567890abcdef'})).rejects.toEqual(
      new ConflictException('La prueba gratuita ya fue utilizada con este teléfono o dispositivo'),
    );
  });

  it('crea una solicitud de verificación por WhatsApp sin activar todavía la prueba', async () => {
    const request = {id:'request-1',code:'GF-T-ABC123',gymId:'gym-1',plan:GymSubscriptionPlan.TRIAL,status:'PENDING',requestedAt:new Date(),lastRequestedAt:new Date(),resendCount:0};
    const prisma = {
      user:{findUnique:jest.fn().mockResolvedValue({phone:'51234567'})},
      trialClaim:{findFirst:jest.fn().mockResolvedValue(null)},
      subscriptionRequest:{findFirst:jest.fn().mockResolvedValue(null),count:jest.fn().mockResolvedValue(0)},
      $transaction:jest.fn(async(callback:(tx:unknown)=>unknown)=>callback({
        gym:{findUniqueOrThrow:jest.fn().mockResolvedValue({subscriptionPlan:null})},
        subscriptionRequest:{updateMany:jest.fn(),create:jest.fn().mockResolvedValue(request)},
      })),
    };
    const service = new AuthService(prisma as never,{signAsync:jest.fn()} as never,{} as never);
    jest.spyOn(service as never,'profile').mockResolvedValue({subscriptionRequest:request} as never);

    await expect(service.selectSubscription(authUser,{plan:GymSubscriptionPlan.TRIAL,deviceId:'android:1234567890abcdef'},'192.0.2.10')).resolves.toMatchObject({request:{plan:GymSubscriptionPlan.TRIAL,status:'PENDING'}});
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('limita el reenvío inmediato de una solicitud de prueba pendiente', async () => {
    const pending = {id:'request-1',requestedAt:new Date(),lastRequestedAt:new Date(),resendCount:0};
    const prisma = {
      user:{findUnique:jest.fn().mockResolvedValue({phone:'51234567'})},
      trialClaim:{findFirst:jest.fn().mockResolvedValue(null)},
      subscriptionRequest:{findFirst:jest.fn().mockResolvedValue(pending)},
    };
    const service = new AuthService(prisma as never,{signAsync:jest.fn()} as never,{} as never);

    await expect(service.selectSubscription(authUser,{plan:GymSubscriptionPlan.TRIAL,deviceId:'android:1234567890abcdef'},'192.0.2.10')).rejects.toMatchObject({status:429});
  });

  it('limita a cinco solicitudes diarias por teléfono o dispositivo', async () => {
    const prisma = {
      user:{findUnique:jest.fn().mockResolvedValue({phone:'51234567'})},
      trialClaim:{findFirst:jest.fn().mockResolvedValue(null)},
      subscriptionRequest:{findFirst:jest.fn().mockResolvedValue(null),count:jest.fn().mockResolvedValue(5)},
    };
    const service = new AuthService(prisma as never,{signAsync:jest.fn()} as never,{} as never);

    await expect(service.selectSubscription(authUser,{plan:GymSubscriptionPlan.TRIAL,deviceId:'android:1234567890abcdef'})).rejects.toMatchObject({status:429});
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
