import { PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
export class ApplyPaymentDto { @IsOptional() @IsUUID() clientMutationId?: string; @IsOptional() @IsDateString() occurredAt?: string; @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number; @IsEnum(PaymentMethod) method: PaymentMethod; @IsOptional() @IsString() @MaxLength(100) reference?: string; }
