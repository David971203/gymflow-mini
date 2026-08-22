import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './auth.dto';
import { CurrentUser, Public, type AuthUser } from './common';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto); }
  @Get('me') me(@CurrentUser() user: AuthUser) { return this.auth.me(user); }
}

