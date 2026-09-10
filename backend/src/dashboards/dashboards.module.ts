import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { DashboardsService } from './dashboards.service';

@Module({ imports: [PrismaModule], providers: [DashboardsService], exports: [DashboardsService] })
export class DashboardsModule {}
