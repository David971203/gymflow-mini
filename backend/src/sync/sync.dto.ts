import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsObject, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
export const SYNC_OPERATION_TYPES = ['MEMBER_CREATE', 'MEMBER_CREATE_WITH_MEMBERSHIP', 'MEMBER_UPDATE', 'MEMBER_DELETE', 'PLAN_CREATE', 'PLAN_UPDATE', 'PLAN_DELETE', 'MEMBERSHIP_ASSIGN', 'MEMBERSHIP_UPDATE', 'MEMBERSHIP_RENEW', 'MEMBERSHIP_DELETE', 'PAYMENT_APPLY', 'ATTENDANCE_CHECK_IN', 'ATTENDANCE_CHECK_OUT'] as const;
export type SyncOperationType = (typeof SYNC_OPERATION_TYPES)[number];
export class SyncOperationDto { @IsUUID() id: string; @IsIn(SYNC_OPERATION_TYPES) type: SyncOperationType; @IsString() @MinLength(1) @MaxLength(191) entityId: string; @IsDateString() occurredAt: string; @IsObject() payload: Record<string, unknown>; }
export class SyncPushDto { @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SyncOperationDto) operations: SyncOperationDto[]; }
