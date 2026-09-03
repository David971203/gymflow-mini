import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole, type Prisma } from '@prisma/client';
import type { AuthUser } from './common';
import { CheckInAttendanceDto, CheckOutAttendanceDto } from './attendance.dto';
import { AttendanceService } from './attendance.service';
import {
  ApplyPaymentDto,
  CreateMemberDto,
  CreateMembershipDto,
  CreatePlanDto,
  RenewMembershipDto,
  SyncOperationDto,
  SyncPushDto,
  UpdateGymMembershipDto,
  UpdateMemberDto,
  UpdatePlanDto,
} from './mini.dto';
import { MiniService } from './mini.service';
import { PrismaService } from './prisma.service';

type SyncResult = {
  id: string;
  type: SyncOperationDto['type'];
  entityId: string;
  status: 'APPLIED' | 'MERGED' | 'REJECTED';
  result?: Prisma.JsonValue;
  message?: string;
};

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService, private readonly mini: MiniService, private readonly attendance: AttendanceService) {}

  async push(dto: SyncPushDto, user: AuthUser) {
    if (!user.gymId) throw new BadRequestException('El usuario no pertenece a un gimnasio');
    const results: SyncResult[] = [];
    const aliases = new Map<string, string>();
    for (const original of dto.operations) {
      const payload = { ...original.payload };
      for (const key of ['memberId', 'planId']) {
        const value = payload[key];
        if (typeof value === 'string' && aliases.has(value)) payload[key] = aliases.get(value) as string;
      }
      const operation = { ...original, entityId: aliases.get(original.entityId) ?? original.entityId, payload };
      const result = await this.process(operation, user);
      results.push({ ...result, entityId: original.entityId });
      if (result.status === 'MERGED' && result.result && typeof result.result === 'object' && !Array.isArray(result.result)) {
        const canonicalId = (result.result as Record<string, unknown>).id;
        if (typeof canonicalId === 'string') aliases.set(original.entityId, canonicalId);
      }
    }
    return { results, serverTime: new Date().toISOString() };
  }

  async snapshot(user: AuthUser) {
    const [dashboard, members, plans, payments, attendances] = await Promise.all([
      this.mini.adminDashboard(user),
      this.mini.listMembers(user),
      this.mini.listPlans(user),
      this.mini.listPayments(user),
      this.attendance.snapshot(user),
    ]);
    return { dashboard, members, plans, payments, attendances, serverTime: new Date().toISOString() };
  }

  private async process(operation: SyncOperationDto, user: AuthUser): Promise<SyncResult> {
    const existing = await this.prisma.syncReceipt.findUnique({ where: { id: operation.id } });
    if (existing) {
      if (existing.gymId !== user.gymId) throw new ConflictException('El identificador de operación ya pertenece a otro gimnasio');
      return {
        id: existing.id,
        type: existing.type as SyncOperationDto['type'],
        entityId: existing.entityId,
        status: existing.status as SyncResult['status'],
        ...(existing.result !== null ? { result: existing.result } : {}),
        ...(existing.message ? { message: existing.message } : {}),
      };
    }

    try {
      const applied = await this.apply(operation, user);
      return await this.saveReceipt(operation, user, applied.status, applied.result);
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() >= 500) throw error;
      const response = error.getResponse();
      const rawMessage = typeof response === 'string' ? response : (response as { message?: string | string[] }).message;
      const message = Array.isArray(rawMessage) ? rawMessage.join(', ') : rawMessage ?? error.message;
      return this.saveReceipt(operation, user, 'REJECTED', undefined, message);
    }
  }

  private async apply(operation: SyncOperationDto, user: AuthUser): Promise<Pick<SyncResult, 'status' | 'result'>> {
    if (user.role === UserRole.RECEPTIONIST && ['MEMBER_DELETE', 'PLAN_CREATE', 'PLAN_UPDATE', 'PLAN_DELETE', 'MEMBERSHIP_DELETE'].includes(operation.type)) {
      throw new ForbiddenException('Tu rol no permite realizar esta operación');
    }
    switch (operation.type) {
      case 'MEMBER_CREATE': {
        const dto = await this.payload(CreateMemberDto, { ...operation.payload, clientId: operation.entityId, occurredAt: operation.occurredAt });
        try {
          const member = await this.mini.createMember(dto, user);
          return { status: 'APPLIED', result: { id: member.id } };
        } catch (error) {
          if (!(error instanceof ConflictException)) throw error;
          const member = await this.mini.findMemberByCi(dto.ci, user);
          if (!member) throw error;
          return { status: 'MERGED', result: { id: member.id, duplicateClientId: operation.entityId } };
        }
      }
      case 'MEMBER_UPDATE': {
        const dto = await this.payload(UpdateMemberDto, operation.payload);
        const member = await this.mini.updateMember(operation.entityId, dto, user);
        return { status: 'APPLIED', result: { id: member.id } };
      }
      case 'MEMBER_DELETE': {
        const result = await this.mini.deleteMember(operation.entityId, user);
        return { status: 'APPLIED', result };
      }
      case 'PLAN_CREATE': {
        const dto = await this.payload(CreatePlanDto, { ...operation.payload, clientId: operation.entityId });
        try {
          const plan = await this.mini.createPlan(dto, user);
          return { status: 'APPLIED', result: { id: plan.id } };
        } catch (error) {
          if (!(error instanceof ConflictException)) throw error;
          const plan = await this.mini.findPlanByName(dto.name, user);
          if (!plan) throw error;
          return { status: 'MERGED', result: { id: plan.id, duplicateClientId: operation.entityId } };
        }
      }
      case 'PLAN_UPDATE': {
        const dto = await this.payload(UpdatePlanDto, operation.payload);
        const plan = await this.mini.updatePlan(operation.entityId, dto, user);
        return { status: 'APPLIED', result: { id: plan.id } };
      }
      case 'PLAN_DELETE': {
        const result = await this.mini.deletePlan(operation.entityId, user);
        return { status: 'APPLIED', result };
      }
      case 'MEMBERSHIP_ASSIGN': {
        const dto = await this.payload(CreateMembershipDto, { ...operation.payload, clientMembershipId: operation.entityId, clientMutationId: operation.id, occurredAt: operation.occurredAt });
        const membership = await this.mini.createMembership(dto, user);
        return { status: 'APPLIED', result: { id: membership.id, paymentId: membership.payment?.id ?? null } };
      }
      case 'MEMBERSHIP_UPDATE': {
        const dto = await this.payload(UpdateGymMembershipDto, operation.payload);
        const membership = await this.mini.updateMembership(operation.entityId, dto, user);
        return { status: 'APPLIED', result: { id: membership.id } };
      }
      case 'MEMBERSHIP_RENEW': {
        const dto = await this.payload(RenewMembershipDto, { ...operation.payload, clientMutationId: operation.id, occurredAt: operation.occurredAt });
        const membership = await this.mini.renewMembership(operation.entityId, dto, user);
        return { status: 'APPLIED', result: { id: membership.id, paymentId: membership.payment?.id ?? null } };
      }
      case 'MEMBERSHIP_DELETE': {
        const result = await this.mini.deleteMembership(operation.entityId, user);
        return { status: 'APPLIED', result };
      }
      case 'PAYMENT_APPLY': {
        const dto = await this.payload(ApplyPaymentDto, { ...operation.payload, clientMutationId: operation.id, occurredAt: operation.occurredAt });
        const payment = await this.mini.applyPayment(operation.entityId, dto, user);
        return { status: 'APPLIED', result: { id: payment.id } };
      }
      case 'ATTENDANCE_CHECK_IN': {
        const dto = await this.payload(CheckInAttendanceDto, { ...operation.payload, clientAttendanceId: operation.entityId, clientMutationId: operation.id, occurredAt: operation.occurredAt });
        const attendance = await this.attendance.checkIn(dto, user);
        return { status: 'APPLIED', result: { id: attendance.id } };
      }
      case 'ATTENDANCE_CHECK_OUT': {
        const dto = await this.payload(CheckOutAttendanceDto, { ...operation.payload, clientMutationId: operation.id, occurredAt: operation.occurredAt });
        const attendance = await this.attendance.checkOut(operation.entityId, dto, user);
        return { status: 'APPLIED', result: { id: attendance.id } };
      }
    }
  }

  private async payload<T extends object>(Dto: new () => T, input: Record<string, unknown>): Promise<T> {
    const instance = plainToInstance(Dto, input);
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) {
      const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}));
      throw new BadRequestException(messages.length ? messages : 'La operación offline contiene datos inválidos');
    }
    return instance;
  }

  private async saveReceipt(
    operation: SyncOperationDto,
    user: AuthUser,
    status: SyncResult['status'],
    result?: Prisma.JsonValue,
    message?: string,
  ): Promise<SyncResult> {
    const receipt = await this.prisma.syncReceipt.upsert({
      where: { id: operation.id },
      create: {
        id: operation.id,
        gymId: user.gymId as string,
        actorUserId: user.id,
        type: operation.type,
        entityId: operation.entityId,
        status,
        ...(result !== undefined ? { result: result as Prisma.InputJsonValue } : {}),
        message,
      },
      update: {},
    });
    return {
      id: receipt.id,
      type: receipt.type as SyncOperationDto['type'],
      entityId: receipt.entityId,
      status: receipt.status as SyncResult['status'],
      ...(receipt.result !== null ? { result: receipt.result } : {}),
      ...(receipt.message ? { message: receipt.message } : {}),
    };
  }
}
