import { AppError, missing, forbidden, invalidState } from './errors.js';

// TODO-01~04: 업무 규칙과 트랜잭션을 직접 구현합니다. docs/API.md를 먼저 읽으세요.
// actor는 검증된 로그인 사용자입니다. repo의 저장 함수는 권한을 검사하지 않습니다.
// 상태 변경과 이력 저장은 함께 성공하거나 함께 실패해야 합니다.
// 승인 취소와 자동 승급은 신청 2건 + 이력 2건을 한 트랜잭션으로 처리합니다.

// [구현] 409 오류 두 가지 (errors.js에 없는 코드라 여기서 만듭니다)
const alreadyApplied = () => new AppError(409,'ALREADY_APPLIED','이미 신청한 행사입니다.');
const capacityFull = () => new AppError(409,'CAPACITY_FULL','정원이 가득 차서 승인할 수 없습니다.');

export function createApplicationService(repo) {
  const db = repo.db;

  // [구현] 트랜잭션 도우미
  // BEGIN IMMEDIATE로 시작해서 검사(SELECT)와 변경(UPDATE/INSERT)을 한 묶음으로 처리합니다.
  // 중간에 오류가 나면(거부 오류 포함) ROLLBACK 해서 요청 전 데이터로 되돌립니다.
  function inTransaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) { /* 이미 끝난 트랜잭션이면 무시 */ }
      throw err;
    }
  }

  // [구현] 신청을 찾고, 행사 담당 운영자인지 확인 (approve, revoke 공통)
  function findForManager(actor, applicationId) {
    const app = repo.application(applicationId);
    if (!app) throw missing('신청');
    const event = repo.event(app.eventId);
    if (actor.role !== 'MANAGER' || event.managerId !== actor.id) throw forbidden();
    return { app, event };
  }

  return {
    apply(actor,eventId) {
      // TODO-01: 행사·학생 역할·중복 검사 → PENDING 저장 + APPLY 이력.
      return inTransaction(() => {
        const event = repo.event(eventId);
        if (!event) throw missing('행사');                       // 대상 존재
        if (actor.role !== 'STUDENT') throw forbidden();          // 권한: 학생만
        if (repo.existing(eventId, actor.id)) throw alreadyApplied(); // 중복: CANCELLED·REVOKED 포함
        const created = repo.insert(eventId, actor.id);           // PENDING 저장
        repo.addHistory({ applicationId: created.id, actorId: actor.id, action: 'APPLY',
          fromStatus: null, toStatus: 'PENDING' });
        return created;
      });
    },
    cancel(actor,applicationId) {
      // TODO-02: 본인의 PENDING만 CANCELLED로 변경 + CANCEL 이력. 자동 승급 없음.
      return inTransaction(() => {
        const app = repo.application(applicationId);
        if (!app) throw missing('신청');
        if (actor.role !== 'STUDENT' || app.userId !== actor.id) throw forbidden(); // 본인만
        if (app.status !== 'PENDING') throw invalidState();                         // 대기만
        const updated = repo.setStatus(app.id, 'CANCELLED');
        repo.addHistory({ applicationId: app.id, actorId: actor.id, action: 'CANCEL',
          fromStatus: 'PENDING', toStatus: 'CANCELLED' });
        return updated;
      });
    },
    approve(actor,applicationId) {
      // TODO-03: 담당자·PENDING·정원 검사 → APPROVED + APPROVE 이력.
      return inTransaction(() => {
        const { app, event } = findForManager(actor, applicationId);
        if (app.status !== 'PENDING') throw invalidState();
        if (repo.approvedCount(event.id) >= event.capacity) throw capacityFull(); // APPROVED만 정원에 포함
        const updated = repo.setStatus(app.id, 'APPROVED');
        repo.addHistory({ applicationId: app.id, actorId: actor.id, action: 'APPROVE',
          fromStatus: 'PENDING', toStatus: 'APPROVED' });
        return updated;
      });
    },
    revoke(actor,applicationId,reason) {
      // TODO-04: 담당자·APPROVED 검사 → REVOKED + REVOKE 이력 → 대기자 1명 자동 승급.
      // 신청 2건 + 이력 2건을 한 트랜잭션으로 묶어서 하나라도 실패하면 전부 롤백합니다.
      return inTransaction(() => {
        const { app } = findForManager(actor, applicationId);
        if (app.status !== 'APPROVED') throw invalidState(); // 반복 승인 취소도 여기서 거부

        // 1) 승인 취소 + REVOKE 이력
        const revoked = repo.setStatus(app.id, 'REVOKED');
        const revokeHistoryId = repo.addHistory({ applicationId: app.id, actorId: actor.id,
          action: 'REVOKE', fromStatus: 'APPROVED', toStatus: 'REVOKED', reason });

        // 2) 같은 행사 대기자 중 created_at ASC, id ASC 첫 1명 (없으면 null)
        const next = repo.nextPending(app.eventId);
        let promoted = null;
        if (next) {
          promoted = repo.setStatus(next.id, 'APPROVED');
          repo.addHistory({ applicationId: next.id, actorId: actor.id, action: 'AUTO_APPROVE',
            fromStatus: 'PENDING', toStatus: 'APPROVED', causeHistoryId: revokeHistoryId });
        }
        return { revoked, promoted };
      });
    }
  };
}