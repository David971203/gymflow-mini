import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { GymSubscriptionGuard, JwtGuard, RolesGuard } from './guards';
import { HealthController } from './health.controller';
import { JwtStrategy } from './jwt.strategy';
import { AdminController, PlatformController } from './mini.controller';
import { MiniService } from './mini.service';
import { MembershipExpirationService } from './membership-expiration.service';
import { MailService } from './mail.service';
import { PrismaService } from './prisma.service';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PassportModule,
    JwtModule.registerAsync({ inject: [ConfigService], useFactory: (config: ConfigService) => ({ secret: config.getOrThrow('JWT_SECRET'), signOptions: { expiresIn: '12h' } }) }),
  ],
  controllers: [HealthController, AuthController, PlatformController, AdminController, AttendanceController, SyncController],
  providers: [PrismaService, AuthService, MailService, MiniService, AttendanceService, MembershipExpirationService, SyncService, JwtStrategy, { provide: APP_GUARD, useClass: JwtGuard }, { provide: APP_GUARD, useClass: RolesGuard }, { provide: APP_GUARD, useClass: GymSubscriptionGuard }],
})
export class AppModule {}
