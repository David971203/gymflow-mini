import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { StaffService } from './staff.service';

@Module({ imports: [PrismaModule], providers: [StaffService], exports: [StaffService] })
export class StaffModule {}
