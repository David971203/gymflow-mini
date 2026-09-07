import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AttendanceQueryDto, CheckInAttendanceDto, CheckOutAttendanceDto } from './attendance.dto';
import { AttendanceService } from './attendance.service';
import { CurrentUser, Roles, type AuthUser } from './common';

@ApiTags('attendance')
@Controller('attendance')
@Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}
  @Get() list(@Query() query: AttendanceQueryDto, @CurrentUser() user: AuthUser) { return this.attendance.list(user, query); }
  @Post('check-in') checkIn(@Body() dto: CheckInAttendanceDto, @CurrentUser() user: AuthUser) { return this.attendance.checkIn(dto, user); }
  @Post(':id/check-out') checkOut(@Param('id') id: string, @Body() dto: CheckOutAttendanceDto, @CurrentUser() user: AuthUser) { return this.attendance.checkOut(id, dto, user); }
}
