import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles, type AuthUser } from './common';
import { SyncPushDto } from './mini.dto';
import { SyncService } from './sync.service';

@ApiTags('offline-sync')
@Controller('sync')
@Roles(UserRole.ADMIN)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('push') push(@Body() dto: SyncPushDto, @CurrentUser() user: AuthUser) {
    return this.sync.push(dto, user);
  }

  @Get('snapshot') snapshot(@CurrentUser() user: AuthUser) {
    return this.sync.snapshot(user);
  }
}
