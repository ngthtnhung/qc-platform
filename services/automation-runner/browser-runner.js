/**
 * Internal AI QA Testing Platform - Automation Runner & Context Manager
 * Manages isolated browser contexts, step execution, diagnostics, and human-in-the-loop Org confirmation.
 * Defined in Section 4.1.F & Section 5.1 of System Design v1.0.
 */

import { PolicyEngine } from '../../packages/policy-engine/policy-engine.js';
import { DiagnosticsCollector } from '../../packages/diagnostics/collector.js';
import { db } from '../../database/db.js';
import { getRoutes } from '../../packages/account-routes/routes.js';
import { VAULT_ENV_TYPES } from '../../packages/secret-vault/vault.js';

export class BrowserRunner {
  constructor() {
    this.activeSessions = new Map();
  }

  /**
   * Launch / Initialize an isolated browser session for an account & environment
   */
  async createSession({
    accountProfileId,
    environmentProfileId,
    routeUrl = '',
    taskId = null,
    taskParams = null,
    taskBatch = null,
    forceRoute = '',
    user,
    correlationId = 'corr_launch'
  }) {
    await db.init();
    const account = await db.findById('account_profiles', accountProfileId);
    const env = await db.findById('environment_profiles', environmentProfileId);

    if (!account) throw new Error(`Account profile ${accountProfileId} not found`);
    if (!env) throw new Error(`Environment profile ${environmentProfileId} not found`);

    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const isProdTest = env.environment_type === 'PRODUCTION_TEST';

    const sessionState = {
      sessionId,
      accountId: account.id,
      accountName: account.name,
      accountRole: account.role,
      environmentId: env.id,
      environmentName: env.name,
      environmentType: env.environment_type,
      targetUrl: env.login_url || env.base_url,
      // DEMO: luôn đối chiếu với OrgID của môi trường; tài khoản khác chỉ dùng org riêng ở staging
      expectedOrg: isProdTest ? env.org_identifier : (account.expected_org_ref || env.org_identifier),
      username: account.username_ref,
      createdBy: user.id,
      // Link sẽ tự mở sau khi đăng nhập: chỉ nhận link nằm trong danh sách route của tài khoản
      taskId,
      taskParams,
      taskBatch,
      routeUrl: forceRoute || (() => {
        const routes = getRoutes(account, env);
        return (routes.find(r => r.url === routeUrl) || routes[0] || {}).url || '';
      })(),
      readOnly: env.environment_type === 'PRODUCTION',
      isActive: true,
      orgConfirmed: !isProdTest, // STAGING is auto-confirmed, PRODUCTION_TEST requires QC confirmation!
      orgConfirmedBy: !isProdTest ? 'SYSTEM_STAGING' : null,
      orgConfirmedAt: !isProdTest ? new Date().toISOString() : null,
      status: isProdTest ? 'ORG_CONFIRMATION_REQUIRED' : 'READY_FOR_VERIFY',
      createdAt: new Date().toISOString()
    };

    // Evaluate action permission with PolicyEngine
    await PolicyEngine.evaluateAction({
      actor: user,
      action: 'READ', // mở cửa sổ đăng nhập chỉ là đọc; thao tác tự động còn qua executeStep
      environmentProfile: env,
      sessionState: {
        is_active: true,
        org_confirmed: sessionState.orgConfirmed
      },
      correlationId
    }).catch(err => {
      // If error is ORG_NOT_CONFIRMED, that's expected prior to confirmation!
      if (err.code !== 'ORG_NOT_CONFIRMED') {
        throw err;
      }
    });

    const diagnostics = new DiagnosticsCollector(sessionId);
    diagnostics.addConsoleLog('info', `Khởi tạo phiên làm việc cho [${account.role}] tại môi trường [${env.name}].`);

    this.activeSessions.set(sessionId, {
      state: sessionState,
      diagnostics
    });

    return sessionState;
  }

  /**
   * QC confirms organization on Production-Test
   */
  async confirmOrg(sessionId, user) {
    const session = this.activeSessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.state.orgConfirmed = true;
    session.state.orgConfirmedBy = user.display_name || user.id;
    session.state.orgConfirmedAt = new Date().toISOString();
    session.state.status = 'READY_FOR_VERIFY';

    session.diagnostics.addConsoleLog('info', `QC [${user.display_name}] đã xác nhận đúng Org [${session.state.expectedOrg}]. Cho phép kiểm thử.`);

    // Audit log
    await db.insert('audit_events', {
      actor_type: 'USER',
      actor_id: user.id,
      action: 'CONFIRM_ORG',
      resource_type: 'BROWSER_SESSION',
      resource_id: sessionId,
      decision: 'ALLOW',
      reason: `QC confirmed organization ${session.state.expectedOrg}`,
      correlation_id: `corr_org_${sessionId}`
    });

    return session.state;
  }

  /**
   * Execute an automated reproduction or test step with policy validation
   */
  async executeStep(sessionId, step, user) {
    const session = this.activeSessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const env = await db.findById('environment_profiles', session.state.environmentId);

    // Enforce Policy Engine Gate (Fail Closed)
    await PolicyEngine.evaluateAction({
      actor: user,
      action: 'AUTOMATE',
      environmentProfile: env,
      sessionState: {
        is_active: session.state.isActive,
        org_confirmed: session.state.orgConfirmed
      },
      correlationId: `corr_step_${sessionId}`
    });

    // Simulate Step Execution
    const startMs = Date.now();
    session.diagnostics.addConsoleLog('info', `Thực thi bước: ${step.name || step.action}`);

    // If step simulated failure
    const isSuccess = !step.shouldFail;
    const durationMs = Date.now() - startMs + 120;

    if (!isSuccess) {
      session.diagnostics.addNetworkFailure({
        url: `${session.state.targetUrl}/api/v1/action`,
        method: 'POST',
        status: 500,
        statusText: 'Internal Server Error',
        durationMs
      });
      session.diagnostics.addConsoleLog('error', `Lỗi 500 khi thực thi thao tác [${step.name || 'Thao tác'}]`);
    }

    return {
      stepId: step.id || `step_${Date.now()}`,
      status: isSuccess ? 'PASS' : 'FAIL',
      durationMs,
      observedResult: isSuccess ? 'Thao tác thành công theo kỳ vọng.' : 'Hệ thống báo lỗi 500 hoặc không phản hồi.',
      diagnostics: session.diagnostics.getDiagnosticsSummary()
    };
  }

  getSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    return session ? session.state : null;
  }

  getDiagnostics(sessionId) {
    const session = this.activeSessions.get(sessionId);
    return session ? session.diagnostics.getDiagnosticsSummary() : null;
  }

  closeSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.state.isActive = false;
      session.state.status = 'CLOSED';
      this.activeSessions.delete(sessionId);
    }
    return { success: true, sessionId };
  }
}

export const browserRunner = new BrowserRunner();
