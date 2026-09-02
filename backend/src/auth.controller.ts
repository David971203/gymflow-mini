import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, GoogleLoginDto, LoginDto, RegisterDto, ResendEmailVerificationDto, ResetPasswordDto, SelectSubscriptionDto, VerifyEmailDto } from './auth.dto';
import { AllowWithoutSubscription, CurrentUser, Public, Roles, type AuthUser } from './common';
import { UserRole } from '@prisma/client';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto); }
  @Public() @Post('google') googleLogin(@Body() dto: GoogleLoginDto) { return this.auth.googleLogin(dto); }
  @Public() @Post('register') register(@Body() dto: RegisterDto) { return this.auth.register(dto); }
  @Public() @Post('email/verify') verifyEmail(@Body() dto: VerifyEmailDto) { return this.auth.verifyEmail(dto); }
  @Public() @Post('email/resend') resendEmailVerification(@Body() dto: ResendEmailVerificationDto) { return this.auth.resendEmailVerification(dto); }
  @Public() @Post('password/forgot') forgotPassword(@Body() dto: ForgotPasswordDto) { return this.auth.forgotPassword(dto); }
  @Public() @Post('password/reset') resetPassword(@Body() dto: ResetPasswordDto) { return this.auth.resetPassword(dto); }
  @Get('me') @AllowWithoutSubscription() me(@CurrentUser() user: AuthUser) { return this.auth.me(user); }
  @Post('password/change') @Roles(UserRole.ADMIN) @AllowWithoutSubscription()
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) { return this.auth.changePassword(user, dto); }
  @Post('subscription') @Roles(UserRole.ADMIN) @AllowWithoutSubscription()
  selectSubscription(@CurrentUser() user: AuthUser, @Body() dto: SelectSubscriptionDto) { return this.auth.selectSubscription(user, dto); }
}
