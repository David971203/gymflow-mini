import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';

describe('AppModule', () => {
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = originalJwtSecret || 'integration-test-secret';
  });

  afterAll(() => {
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  it('resolves the complete application dependency graph', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();

    await module.close();
  });
});
