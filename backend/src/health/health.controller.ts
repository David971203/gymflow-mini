import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/auth-context';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  status() {
    return { status: 'ok' };
  }
}
