import { GymSubscriptionPlan } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
}

export class GoogleLoginDto {
  @IsString() @MinLength(100) @MaxLength(4096) idToken: string;
}

export class RegisterDto {
  @IsString() @MaxLength(100) ownerName: string;
  @IsString() @MaxLength(100) gymName: string;
  @IsOptional() @IsString() @MaxLength(100) province?: string;
  @IsString() @Matches(/^\d{8}$/, { message: 'El teléfono móvil debe tener exactamente 8 dígitos' }) phone: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsString() @MinLength(12) @MaxLength(200) deviceId: string;
}

export class SelectSubscriptionDto {
  @IsEnum(GymSubscriptionPlan) plan: GymSubscriptionPlan;
  @IsString() @MinLength(12) @MaxLength(200) deviceId: string;
}

export class ForgotPasswordDto {
  @IsEmail() email: string;
}

export class ResetPasswordDto {
  @IsEmail() email: string;
  @IsString() @Matches(/^\d{6}$/, { message: 'El código debe contener 6 dígitos' }) code: string;
  @IsString() @MinLength(8) newPassword: string;
}

export class ChangePasswordDto {
  @IsString() @MinLength(8) currentPassword: string;
  @IsString() @MinLength(8) newPassword: string;
}
