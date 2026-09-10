import { UnauthorizedException } from '@nestjs/common';
import { GoogleIdentityService } from './google-identity.service';

describe('GoogleIdentityService', () => {
  const config = { get: jest.fn().mockReturnValue('web-client.apps.googleusercontent.com') };

  it('valida la audiencia y normaliza un Gmail confirmado', async () => {
    const service = new GoogleIdentityService(config as never);
    const verifyIdToken = jest.fn().mockResolvedValue({ getPayload:()=>({ email:'Owner@Gmail.com', email_verified:true, sub:'google-1' }) });
    (service as unknown as { client:{ verifyIdToken:typeof verifyIdToken } }).client.verifyIdToken = verifyIdToken;

    await expect(service.verifiedEmail('token-valido')).resolves.toBe('owner@gmail.com');
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken:'token-valido', audience:'web-client.apps.googleusercontent.com' });
  });

  it('rechaza cuentas externas cuyo correo Google no controla actualmente', async () => {
    const service = new GoogleIdentityService(config as never);
    const verifyIdToken = jest.fn().mockResolvedValue({ getPayload:()=>({ email:'owner@example.com', email_verified:true, sub:'google-2' }) });
    (service as unknown as { client:{ verifyIdToken:typeof verifyIdToken } }).client.verifyIdToken = verifyIdToken;

    await expect(service.verifiedEmail('token-externo')).rejects.toEqual(
      new UnauthorizedException('Usa una dirección de Gmail o Google Workspace para acceder con Google'),
    );
  });
});
