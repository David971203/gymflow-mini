import { validate } from 'class-validator';
import { RegisterDto } from './auth.dto';

describe('RegisterDto', () => {
  const registration = (phone: string) => Object.assign(new RegisterDto(), {
    ownerName: 'Ana Pérez',
    gymName: 'Gym Ana',
    province: 'La Habana',
    municipality: 'Plaza',
    phone,
    email: 'ana@example.com',
    password: 'ClaveSegura123',
    deviceId: 'android:1234567890',
  });

  it('acepta un teléfono móvil de exactamente ocho dígitos', async () => {
    const errors = await validate(registration('51234567'));
    expect(errors.find(error => error.property === 'phone')).toBeUndefined();
  });

  it.each(['5123456', '512345678', '+5351234567', '51 234 567', 'abcdefgh'])(
    'rechaza el teléfono no válido %s',
    async phone => {
      const errors = await validate(registration(phone));
      expect(errors.find(error => error.property === 'phone')?.constraints).toEqual(
        expect.objectContaining({ matches: 'El teléfono móvil debe tener exactamente 8 dígitos' }),
      );
    },
  );
});
