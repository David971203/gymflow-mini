import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
export class CreateStaffAccountDto { @IsString() @MaxLength(100) name: string; @IsEmail() email: string; @IsString() @MinLength(8) password: string; }
export class UpdateStaffAccountDto { @IsOptional() @IsString() @MaxLength(100) name?: string; @IsOptional() @IsEmail() email?: string; @IsOptional() @IsString() @MinLength(8) password?: string; @IsOptional() @IsBoolean() isActive?: boolean; }
