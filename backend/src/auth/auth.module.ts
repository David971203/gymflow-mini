import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { MailModule } from '../mail/mail.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AuthController } from './auth.controller';
import { GymSubscriptionGuard, JwtGuard, RolesGuard } from './auth.guards';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { GoogleIdentityService } from './google-identity.service';
import { JwtStrategy } from './jwt.strategy';
import { PasswordRecoveryService } from './password-recovery.service';
import { SubscriptionSelectionService } from './subscription-selection.service';

@Module({
  imports: [PassportModule, MailModule, SubscriptionsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    EmailVerificationService,
    PasswordRecoveryService,
    SubscriptionSelectionService,
    GoogleIdentityService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: GymSubscriptionGuard },
  ],
})
export class AuthModule {}
