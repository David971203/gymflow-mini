import { GymSubscriptionPlan, MembershipStatus, PaymentMethod, SubscriptionRequestStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ArrayMaxSize, ArrayMinSize, ValidateNested } from 'class-validator';

export class CreateGymDto {
  @IsString() @MaxLength(100) name: string;
  @IsString() @MaxLength(80) slug: string;
  @IsOptional() @IsString() province?: string;
  @IsOptional() @IsString() phone?: string;
  @IsIn(['CUP', 'USD']) currency: 'CUP' | 'USD';
  @IsEmail() adminEmail: string;
  @IsString() @MinLength(8) adminPassword: string;
  @IsString() @MaxLength(100) adminName: string;
  @IsEnum(GymSubscriptionPlan) subscriptionPlan: GymSubscriptionPlan;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) subscriptionTrialDays?: number;
}

export class UpdateGymStatusDto { @IsBoolean() isActive: boolean; }
export class UpdateGymSubscriptionDto {
  @IsEnum(GymSubscriptionPlan) subscriptionPlan: GymSubscriptionPlan;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) subscriptionTrialDays?: number;
}

export class ResolveSubscriptionRequestDto {
  @IsIn([SubscriptionRequestStatus.APPROVED, SubscriptionRequestStatus.REJECTED])
  status: 'APPROVED' | 'REJECTED';
}

export class UpdateGymDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(80) @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'El identificador solo admite minúsculas, números y guiones' }) slug?: string;
  @IsOptional() @IsString() @MaxLength(100) province?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsIn(['CUP', 'USD']) currency?: 'CUP' | 'USD';
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateGymAdminDto {
  @IsString() @MaxLength(100) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateGymAdminDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateMemberDto {
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsString()
  @Matches(/^\d{11}$/, { message: 'El carnet de identidad debe contener exactamente 11 dígitos' })
  ci: string;
  @IsOptional() @IsString() @MaxLength(40) code?: string | null;
  @IsString() @MaxLength(80) firstName: string;
  @IsString() @MaxLength(80) lastName: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) age?: number | null;
  @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER']) sex?: 'MALE' | 'FEMALE' | 'OTHER' | null;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(180) address?: string;
}

export class UpdateMemberDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/, { message: 'El carnet de identidad debe contener exactamente 11 dígitos' })
  ci?: string;
  @IsOptional() @IsString() @MaxLength(40) code?: string | null;
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) age?: number | null;
  @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER']) sex?: 'MALE' | 'FEMALE' | 'OTHER' | null;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(180) address?: string;
  @IsOptional() @IsEnum(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
}

export class CreatePlanDto {
  @IsOptional() @IsUUID() clientId?: string;
  @IsString() @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) price: number;
  @Type(() => Number) @IsInt() @Min(1) durationDays: number;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) price?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) durationDays?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateMembershipDto {
  @IsOptional() @IsUUID() clientMembershipId?: string;
  @IsOptional() @IsUUID() clientPaymentId?: string;
  @IsOptional() @IsUUID() clientMutationId?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsString() memberId: string;
  @IsString() planId: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24) periodCount?: number;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) initialPayment?: number;
  @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

export class AssignGymMembershipDto {
  @IsOptional() @IsUUID() clientMembershipId?: string;
  @IsOptional() @IsUUID() clientPaymentId?: string;
  @IsOptional() @IsUUID() clientMutationId?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsString() planId: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24) periodCount?: number;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) initialPayment?: number;
  @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

export class UpdateGymMembershipDto {
  @IsOptional() @IsString() planId?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsEnum(MembershipStatus) status?: MembershipStatus;
}

export class RenewMembershipDto {
  @IsOptional() @IsUUID() clientMembershipId?: string;
  @IsOptional() @IsUUID() clientPaymentId?: string;
  @IsOptional() @IsUUID() clientMutationId?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsOptional() @IsString() planId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24) periodCount?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) initialPayment?: number;
  @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

export class ApplyPaymentDto {
  @IsOptional() @IsUUID() clientMutationId?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @IsEnum(PaymentMethod) method: PaymentMethod;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

export const SYNC_OPERATION_TYPES = [
  'MEMBER_CREATE', 'MEMBER_UPDATE', 'MEMBER_DELETE', 'PLAN_CREATE', 'PLAN_UPDATE', 'PLAN_DELETE',
  'MEMBERSHIP_ASSIGN', 'MEMBERSHIP_UPDATE', 'MEMBERSHIP_RENEW', 'MEMBERSHIP_DELETE', 'PAYMENT_APPLY',
] as const;

export type SyncOperationType = (typeof SYNC_OPERATION_TYPES)[number];

export class SyncOperationDto {
  @IsUUID() id: string;
  @IsIn(SYNC_OPERATION_TYPES) type: SyncOperationType;
  @IsUUID() entityId: string;
  @IsDateString() occurredAt: string;
  @IsObject() payload: Record<string, unknown>;
}

export class SyncPushDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SyncOperationDto)
  operations: SyncOperationDto[];
}
