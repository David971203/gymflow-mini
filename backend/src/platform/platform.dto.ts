import { GymSubscriptionPlan, SubscriptionRequestStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateGymDto {
  @IsString() @MaxLength(100) name: string;
  @IsString() @MaxLength(80) slug: string;
  @IsString() @MaxLength(100) province: string;
  @IsString() @MaxLength(100) municipality: string;
  @IsOptional() @IsString() phone?: string;
  @IsIn(['CUP', 'USD']) currency: 'CUP' | 'USD';
  @IsEmail() adminEmail: string;
  @IsString() @MinLength(8) adminPassword: string;
  @IsString() @MaxLength(100) adminName: string;
  @IsEnum(GymSubscriptionPlan) subscriptionPlan: GymSubscriptionPlan;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) subscriptionTrialDays?: number;
}
export class UpdateGymStatusDto { @IsBoolean() isActive: boolean; }
export class UpdateGymSubscriptionDto { @IsEnum(GymSubscriptionPlan) subscriptionPlan: GymSubscriptionPlan; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) subscriptionTrialDays?: number; }
export class ResolveSubscriptionRequestDto { @IsIn([SubscriptionRequestStatus.APPROVED, SubscriptionRequestStatus.REJECTED]) status: 'APPROVED' | 'REJECTED'; }
export class UpdateGymDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(80) @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'El identificador solo admite minúsculas, números y guiones' }) slug?: string;
  @IsOptional() @IsString() @MaxLength(100) province?: string;
  @IsOptional() @IsString() @MaxLength(100) municipality?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsIn(['CUP', 'USD']) currency?: 'CUP' | 'USD';
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class CreateGymAdminDto { @IsString() @MaxLength(100) name: string; @IsEmail() email: string; @IsString() @MinLength(8) password: string; @IsOptional() @IsBoolean() isActive?: boolean; }
export class UpdateGymAdminDto { @IsOptional() @IsString() @MaxLength(100) name?: string; @IsOptional() @IsEmail() email?: string; @IsOptional() @IsString() @MinLength(8) password?: string; @IsOptional() @IsBoolean() isActive?: boolean; }
