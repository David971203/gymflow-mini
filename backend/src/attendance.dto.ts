import { AttendanceMethod } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CheckInAttendanceDto {
  @IsOptional() @IsUUID() clientAttendanceId?: string;
  @IsOptional() @IsUUID() clientMutationId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(191) memberId?: string;
  @IsOptional() @IsUUID() qrCode?: string;
  @IsOptional() @IsEnum(AttendanceMethod) method?: AttendanceMethod;
  @IsOptional() @IsDateString() occurredAt?: string;
}

export class CheckOutAttendanceDto {
  @IsOptional() @IsUUID() clientMutationId?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
}

export class AttendanceQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(191) memberId?: string;
}
