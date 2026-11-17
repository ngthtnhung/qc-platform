/**
 * Internal AI QA Testing Platform - Task Management System Adapter
 * Interfaces with Jira / Haraworks / Internal Task System.
 * Implements strict Idempotency, Pre-checks, and Remote State Verification.
 * Defined in Section 5.7 of System Design v1.0.
 */

import { db } from '../../database/db.js';
import { Redactor } from '../diagnostics/redactor.js';

export class TaskAdapter {
  constructor(options = {}) {
    this.isSandbox = options.isSandbox ?? true;
    this.remoteTasksStore = new Map(); // In-memory simulated remote task server for Sandbox mode
  }

  /**
   * Search / Read task by External ID
   */
  async getTask(externalTaskId) {
    if (this.isSandbox) {
      // Check local DB mirror first
      const task = await db.findOne('external_tasks', t => t.external_task_id === externalTaskId);
      if (task) return task;
      return this.remoteTasksStore.get(externalTaskId) || null;
    }
    // Real API integration implementation here
    throw new Error('Real task system connector requires authorized corporate credentials.');
  }

  /**
   * Submit a new Bug Sub-task with Idempotency Key & Remote State Verification
   * @param {object} params
   * @param {string} params.parentTaskId External parent task ID
   * @param {string} params.title Title starting with [BUG]
   * @param {string} params.moduleName Module name
   * @param {string} params.devPic Dev PIC name / ID
   * @param {string} params.dueDate Due date calculated via SLA
   * @param {string} params.qcReviewer QC Reviewer name
   * @param {Array} params.steps Repro steps
   * @param {string} params.observed Error details
   * @param {string} params.expected Expected result
   * @param {Array} params.evidenceRefs Evidence assets list
   * @param {string} params.idempotencyKey Unique transaction key
   */
  async createBugSubtask({
    parentTaskId = 'MAINT-502',
    title,
    moduleName = 'Bảo trì',
    devPic = 'Lê Vĩnh Ngọc Châu',
    dueDate = '2026-05-17',
    qcReviewer = 'QC Tester',
    steps = [],
    observed = '',
    expected = '',
    evidenceRefs = [],
    idempotencyKey = null
  }) {
    if (!title || !title.startsWith('[BUG]')) {
      title = `[BUG] ${title || 'Lỗi phát sinh trong quá trình kiểm thử'}`;
    }

    // 1. Pre-check: Idempotency Key check
    if (idempotencyKey) {
      const existing = await db.findOne('external_tasks', t => t.metadata && t.metadata.includes(idempotencyKey));
      if (existing) {
        console.log(`[TaskAdapter] Task already created with key ${idempotencyKey}. Returning existing.`);
        return {
          success: true,
          task: existing,
          isDuplicate: true,
          message: 'Task đã được tạo trước đó (Idempotent Hit).'
        };
      }
    }

    const subtaskId = `BUG-SUB-${Date.now().toString().slice(-4)}`;
    const stepsFormatted = steps.map((s, idx) => `${idx + 1}. ${s}`).join('\n');

    const formattedDescription = `
h3. Thông Tin Lỗi
* *Mô-đun:* ${moduleName}
* *Người thực hiện (Dev PIC):* ${devPic}
* *Người duyệt (QC Reviewer):* ${qcReviewer}
* *Hạn hoàn thành (SLA):* ${dueDate}
* *Trạng thái:* Chờ Dev fix round 1

h3. Chi Tiết Lỗi & Kỳ Vọng
* *Quan sát thực tế:* ${observed || 'Thao tác không đạt kết quả mong muốn'}
* *Kỳ vọng:* ${expected || 'Hệ thống hoạt động đúng theo quy chuẩn nghiệp vụ'}

h3. Các Bước Tái Hiện (Reproduction Steps)
${stepsFormatted || '1. Mở hệ thống và thực hiện theo kịch bản kiểm thử.'}

h3. Bằng Chứng Đính Kèm (Evidence)
${evidenceRefs.length > 0 ? evidenceRefs.map(e => `* File/Asset: ${e}`).join('\n') : '* Xem log và screenshot đính kèm.'}
    `.trim();

    // 2. Submit to remote task system
    const taskRecord = {
      id: `ext_task_${Date.now()}`,
      external_task_id: subtaskId,
      external_url: `https://app.erp-saas.com/org/cx-tickets/${subtaskId}`,
      project_id: 'proj_erp',
      module_id: 'mod_maint',
      task_type: 'CUSTOMER_BUG',
      title,
      description: formattedDescription,
      external_status: 'OPEN_DEV_FIX',
      priority: 'High',
      assignee_external_id: devPic,
      reviewer_external_id: qcReviewer,
      due_at: dueDate,
      last_synced_at: new Date().toISOString(),
      metadata: JSON.stringify({
        parentTaskId,
        idempotencyKey,
        evidenceCount: evidenceRefs.length
      })
    };

    if (this.isSandbox) {
      this.remoteTasksStore.set(subtaskId, taskRecord);
    }

    // 3. Remote State Verification (Section 5.7 & 6.4)
    // Read back to guarantee remote creation succeeded
    const verified = await this.getTask(subtaskId);
    if (!verified) {
      throw new Error(`Remote state verification failed for task ${subtaskId}`);
    }

    // Mirror in local DB
    await db.insert('external_tasks', taskRecord);

    return {
      success: true,
      task: taskRecord,
      isDuplicate: false,
      message: `Đã tạo thành công subtask [${subtaskId}] trên hệ thống task.`
    };
  }
}

export const taskAdapter = new TaskAdapter({ isSandbox: true });
