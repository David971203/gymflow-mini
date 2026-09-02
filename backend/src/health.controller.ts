import { Controller, Get } from '@nestjs/common';
import { Public } from './common';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  status() {
    return { status: 'ok' };
  }
}
