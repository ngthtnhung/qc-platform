/**
 * Internal AI QA Testing Platform - Policy & Approval Engine
 * Enforces "Fail Closed" security rules, Org confirmation gates, and least-privilege action matrices.
 * Defined in Section 9 of System Design v1.0.
 */

import { db } from '../../database/db.js';

export const ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  ENVIRONMENT_NOT_ALLOWED: 'ENVIRONMENT_NOT_ALLOWED',
  ORG_NOT_CONFIRMED: 'ORG_NOT_CONFIRMED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  POLICY_BLOCKED: 'POLICY_BLOCKED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED'
};

export class PolicyEngine {
  /**
   * Evaluate whether an action is permitted on an environment under current session context
   * @param {object} params
   * @param {object} params.actor { id, role, type: 'USER' | 'AI' | 'SYSTEM' }
   * @param {string} params.action 'READ' | 'REPRODUCE' | 'AUTOMATE' | 'WRITE' | 'TASK_WRITE' | 'CONFIRM_ORG'
   * @param {object} params.environmentProfile { id, environment_type, allowed_actions, requires_org_confirmation }
   * @param {object} params.sessionState { session_id, is_active, org_confirmed, org_identifier, expired_at }
   * @param {string} params.correlationId Trace correlation ID
   */
  static async evaluateAction({ actor, action, environmentProfile, sessionState = {}, correlationId = 'trace_default' }) {
    const timestamp = new Date().toISOString();

    // 1. Fail Closed: Actor check
    if (!actor || !actor.id) {
      await this.logAudit({ actor, action, decision: 'DENY', reason: 'Missing actor context', correlationId });
      throw new PolicyError(ERROR_CODES.AUTH_REQUIRED, 'Yêu cầu xác thực người dùng trước khi thực thi.');
    }

    // 2. AI can never self-approve or grant permissions
    if (actor.type === 'AI' && (action === 'APPROVE' || action === 'CONFIRM_ORG' || action === 'TASK_WRITE')) {
      await this.logAudit({ actor, action, decision: 'DENY', reason: 'AI cannot self-approve or execute privileged write actions', correlationId });
      throw new PolicyError(ERROR_CODES.PERMISSION_DENIED, 'AI chỉ có quyền phân tích/đề xuất, không được tự vượt qua cổng phê duyệt.');
    }

    // 3. Environment existence check
    if (!environmentProfile) {
      await this.logAudit({ actor, action, decision: 'DENY', reason: 'Unrecognized environment profile', correlationId });
      throw new PolicyError(ERROR_CODES.ENVIRONMENT_NOT_ALLOWED, 'Không xác minh được cấu hình môi trường.');
    }

    const envType = environmentProfile.environment_type;
    const allowedActions = Array.isArray(environmentProfile.allowed_actions)
      ? environmentProfile.allowed_actions
      : JSON.parse(environmentProfile.allowed_actions || '[]');

    // 4. Session validity check
    if (sessionState.is_active === false || (sessionState.expired_at && new Date(sessionState.expired_at) < new Date())) {
      await this.logAudit({ actor, action, decision: 'DENY', reason: 'Session expired or invalid', correlationId });
      throw new PolicyError(ERROR_CODES.SESSION_EXPIRED, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    }

    // 5. Critical Gate: PRODUCTION_TEST requires explicit Org Confirmation
    if (envType === 'PRODUCTION_TEST') {
      if (environmentProfile.requires_org_confirmation && action !== 'CONFIRM_ORG') {
        if (!sessionState.org_confirmed) {
          await this.logAudit({ actor, action, decision: 'DENY', reason: 'Production-test requires explicit QC org confirmation prior to execution', correlationId });
          throw new PolicyError(
            ERROR_CODES.ORG_NOT_CONFIRMED,
            'Môi trường Production (Org Test) bắt buộc QC phải nhấn xác nhận đúng Org trước khi bắt đầu kiểm thử hoặc tái hiện bug.'
          );
        }
      }
    }

    // 6. Production Safety: Strictly block destructive or direct write commands
    if (envType === 'PRODUCTION') {
      if (['WRITE', 'MIGRATE', 'RELEASE', 'DELETE_DATA'].includes(action)) {
        await this.logAudit({ actor, action, decision: 'DENY', reason: 'Production write operations are strictly prohibited', correlationId });
        throw new PolicyError(ERROR_CODES.POLICY_BLOCKED, 'Môi trường Production không cho phép tự động thực hiện thao tác ghi/migrate.');
      }
    }

    // 7. Check allowed actions in environment profile
    if (!allowedActions.includes(action) && !allowedActions.includes('*') && action !== 'CONFIRM_ORG') {
      await this.logAudit({ actor, action, decision: 'DENY', reason: `Action ${action} is not in allowed actions for ${envType}`, correlationId });
      throw new PolicyError(ERROR_CODES.POLICY_BLOCKED, `Hành động [${action}] không nằm trong phạm vi cho phép của môi trường ${envType}.`);
    }

    // Log Approval / Allow
    await this.logAudit({ actor, action, decision: 'ALLOW', reason: 'Passed all policy security gates', correlationId });
    return {
      allowed: true,
      timestamp,
      decision: 'ALLOW'
    };
  }

  static async logAudit({ actor, action, decision, reason, correlationId }) {
    try {
      await db.insert('audit_events', {
        actor_type: actor?.type || 'USER',
        actor_id: actor?.id || null,
        action: action || 'UNKNOWN',
        resource_type: 'ENVIRONMENT_ACTION',
        decision,
        reason,
        correlation_id: correlationId || `corr_${Date.now()}`,
        metadata_redacted: JSON.stringify({ actor_role: actor?.role })
      });
    } catch (err) {
      console.warn('[PolicyEngine] Audit log write failed:', err.message);
    }
  }
}

export class PolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
  }
}
