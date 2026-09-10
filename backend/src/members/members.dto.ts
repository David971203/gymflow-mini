import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
export class CreateMemberDto {
  @IsOptional() @IsUUID() clientId?: string; @IsOptional() @IsUUID() qrCode?: string; @IsOptional() @IsDateString() occurredAt?: string;
  @IsString() @Matches(/^\d{11}$/, { message: 'El carnet de identidad debe contener exactamente 11 dígitos' }) ci: string;
  @IsOptional() @IsString() @MaxLength(40) code?: string | null; @IsString() @MaxLength(80) firstName: string; @IsString() @MaxLength(80) lastName: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) age?: number | null; @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER']) sex?: 'MALE' | 'FEMALE' | 'OTHER' | null;
  @IsOptional() @IsString() @MaxLength(30) phone?: string; @IsOptional() @IsString() @MaxLength(180) address?: string;
}
export class UpdateMemberDto {
  @IsOptional() @IsString() @Matches(/^\d{11}$/, { message: 'El carnet de identidad debe contener exactamente 11 dígitos' }) ci?: string;
  @IsOptional() @IsString() @MaxLength(40) code?: string | null; @IsOptional() @IsString() @MaxLength(80) firstName?: string; @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) age?: number | null; @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER']) sex?: 'MALE' | 'FEMALE' | 'OTHER' | null;
  @IsOptional() @IsString() @MaxLength(30) phone?: string; @IsOptional() @IsString() @MaxLength(180) address?: string;
}
