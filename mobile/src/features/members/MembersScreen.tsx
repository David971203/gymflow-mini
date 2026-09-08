import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';

import { offline, syncNow } from '../../offline';
import { FEATURES } from '../../core/config';
import type { Currency, Member, Plan } from '../../types';
import { contractedPlan } from '../../utils/domainFormatters';
import { scheduledMembership } from '../../utils/membershipSelectors';
import { BottomSheet } from '../../components/BottomSheet';
import { MembersList, type MemberFilter } from './MembersList';
import { MemberActionsContent, memberActionsTitle } from './MemberActionsContent';
import { AssignPlanForm, RenewMembershipForm, ScheduledMembershipForm } from './MembershipForms';
import { MemberForm } from './MemberForm';

type MembersScreenProps = {
  scope: string;
  revision: number;
  initialFilter: MemberFilter;
  canDelete: boolean;
  currency: Currency;
  dark: boolean;
  ensureSubscription: () => void;
  withActiveSubscription: (action: () => void) => void;
  hasInternet: () => Promise<boolean>;
  reportMutation: (scope: string, operationId: string, acceptedMessage: string, pendingMessage?: string) => Promise<string>;
  onError: (error: unknown) => void;
  onSuccess: (message: string) => void;
  onPending: (message: string) => void;
  onRejected: (message: string) => void;
  renderModalOverlay?: (active: boolean) => ReactNode;
};

export function MembersScreen({ scope, revision, initialFilter, canDelete, currency, dark, ensureSubscription, withActiveSubscription, hasInternet, reportMutation, onError, onSuccess, onPending, onRejected, renderModalOverlay }: MembersScreenProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<Member | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [assigning, setAssigning] = useState<Member | null>(null);
  const [renewing, setRenewing] = useState<Member | null>(null);
  const [editingScheduled, setEditingScheduled] = useState<Member | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([offline.members(scope), offline.plans(scope)])
      .then(([nextMembers, nextPlans]) => { setMembers(nextMembers); setPlans(nextPlans); })
      .catch(onError)
      .finally(() => setLoading(false));
  }, [onError, scope]);
  const refresh = useCallback(() => { void syncNow(scope).then(load); }, [scope, load]);

  const confirmDelete = (member: Member) => Alert.alert(
    'Archivar miembro',
    `¿Deseas archivar a ${member.firstName} ${member.lastName}? Quedará inactivo y se cancelarán sus membresías vigentes. Los cobros, importes y abonos conservarán su estado y seguirán visibles en Caja.`,
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Archivar', style: 'destructive', onPress: () => {
        try {
          ensureSubscription();
          void offline.deleteMember(scope, member.id).then(async operationId => {
            const status = await reportMutation(scope, operationId, 'Miembro archivado. Sus cobros y abonos se conservaron.', 'Archivo guardado en este dispositivo. Se confirmará al recuperar conexión.');
            if (status !== 'REJECTED') setSelected(null);
            load();
          }).catch(onError);
        } catch (error) { onError(error); }
      } },
    ],
  );
  const confirmDeleteScheduled = (member: Member) => {
    const scheduled = scheduledMembership(member);
    if (!scheduled) return;
    Alert.alert('Eliminar renovación', `¿Deseas eliminar la renovación programada del plan ${contractedPlan(scheduled).name}? La membresía actual no cambiará.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => {
        try {
          ensureSubscription();
          void offline.deleteScheduledMembership(scope, member.id, scheduled.id).then(async operationId => {
            const status = await reportMutation(scope, operationId, 'Renovación eliminada.', 'El cambio quedó guardado en este dispositivo.');
            if (status !== 'REJECTED') setSelected(null);
            load();
          }).catch(onError);
        } catch (error) { onError(error); }
      } },
    ]);
  };

  useEffect(load, [load, revision]);

  if (addOpen || editing) return <MemberForm scope={scope} open member={editing} plans={plans} currency={currency} dark={dark} ensureSubscription={ensureSubscription} hasInternet={hasInternet} onError={onError} onSuccess={onSuccess} onPending={onPending} onRejected={onRejected} onClose={() => { setAddOpen(false); setEditing(null); }} onSaved={() => { setAddOpen(false); setEditing(null); load(); }} />;

  return <>
    <MembersList members={members} loading={loading} initialFilter={initialFilter} dark={dark} onRefresh={refresh} onAdd={() => withActiveSubscription(() => setAddOpen(true))} onSelect={setSelected} />
    <BottomSheet open={!!selected} title={memberActionsTitle(selected)} onClose={() => setSelected(null)} dark={dark} overlay={renderModalOverlay?.(!!selected)}>
      <MemberActionsContent member={selected} canDelete={canDelete} dark={dark} scheduledMembershipEnabled={FEATURES.scheduledMembership} onEdit={() => withActiveSubscription(() => { if (selected) setEditing(selected); setSelected(null); })} onPlan={() => withActiveSubscription(() => { if (selected) setAssigning(selected); setSelected(null); })} onRenew={() => withActiveSubscription(() => { if (selected) setRenewing(selected); setSelected(null); })} onEditScheduled={() => withActiveSubscription(() => { if (selected) setEditingScheduled(selected); setSelected(null); })} onDeleteScheduled={() => withActiveSubscription(() => { if (selected) confirmDeleteScheduled(selected); })} onDelete={() => withActiveSubscription(() => { if (selected) confirmDelete(selected); })} />
    </BottomSheet>
    <AssignPlanForm scope={scope} member={assigning} plans={plans} currency={currency} dark={dark} ensureSubscription={ensureSubscription} reportMutation={reportMutation} onError={onError} overlay={renderModalOverlay?.(!!assigning)} onClose={() => setAssigning(null)} onSaved={() => { setAssigning(null); load(); }} />
    {FEATURES.scheduledMembership ? <RenewMembershipForm scope={scope} member={renewing} plans={plans} currency={currency} dark={dark} ensureSubscription={ensureSubscription} reportMutation={reportMutation} onError={onError} overlay={renderModalOverlay?.(!!renewing)} onClose={() => setRenewing(null)} onSaved={() => { setRenewing(null); load(); }} /> : null}
    {FEATURES.scheduledMembership ? <ScheduledMembershipForm scope={scope} member={editingScheduled} plans={plans} currency={currency} dark={dark} ensureSubscription={ensureSubscription} reportMutation={reportMutation} onError={onError} overlay={renderModalOverlay?.(!!editingScheduled)} onClose={() => setEditingScheduled(null)} onSaved={() => { setEditingScheduled(null); load(); }} /> : null}
  </>;
}
