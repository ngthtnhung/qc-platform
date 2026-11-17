/**
 * Internal AI QA Testing Platform - 16-Column Test Case Template Schema & Validator
 * Strictly adheres to Section 5.5 mandatory template columns:
 * Link Task | ID | Test Type | Platform | Test objective | Module | Screen | Functional | Steps | Account | Precondition / Test Data | Expected Result | Actual Result | Image / Video | Status | Note
 */

export const MANDATORY_COLUMNS = [
  'link_task',
  'case_key', // ID
  'test_type',
  'platform',
  'objective',
  'module_name',
  'screen_name',
  'functional_area',
  'steps',
  'account',
  'preconditions_test_data',
  'expected_result',
  'actual_result',
  'image_video_ref',
  'status',
  'notes'
];

export const VALID_STATUSES = ['UNTESTED', 'PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'INCONCLUSIVE'];
export const VALID_TEST_TYPES = ['Functional', 'Boundary', 'Negative', 'RBAC', 'UI/UX', 'Migration', 'Regression'];

export class TestCaseSchemaValidator {
  /**
   * Validate a single test case record
   */
  static validate(tc) {
    const errors = [];

    if (!tc.case_key && !tc.id) errors.push('Thiếu trường ID (case_key)');
    if (!tc.objective || tc.objective.trim() === '') errors.push('Thiếu mục tiêu kiểm thử (Test objective)');
    if (!tc.module_name) errors.push('Thiếu tên phân hệ (Module)');
    if (!tc.steps) errors.push('Thiếu các bước thực hiện (Steps)');
    if (!tc.expected_result) errors.push('Thiếu kết quả mong đợi (Expected Result)');

    const status = (tc.status || 'UNTESTED').toUpperCase();
    if (!VALID_STATUSES.includes(status)) {
      errors.push(`Trạng thái [${tc.status}] không hợp lệ. Cho phép: ${VALID_STATUSES.join(', ')}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Normalize test case object into standardized 16-column format
   */
  static normalize(tc, defaults = {}) {
    const stepsFormatted = Array.isArray(tc.steps)
      ? tc.steps.map((s, idx) => typeof s === 'string' ? `${idx + 1}. ${s}` : `${idx + 1}. ${s.action || s.title || s}`).join('\n')
      : (tc.steps || '');

    return {
      id: tc.id || `tc_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      test_plan_id: tc.test_plan_id || defaults.test_plan_id || null,
      link_task: tc.link_task || defaults.link_task || '',
      case_key: tc.case_key || tc.key || `TC-${defaults.module || 'GEN'}-${Date.now().toString().slice(-4)}`,
      test_type: tc.test_type || 'Functional',
      platform: tc.platform || 'Web (Desktop & Mobile)',
      objective: tc.objective || tc.name || tc.title || 'Kiểm thử chức năng',
      module_name: tc.module_name || defaults.module || 'Hệ thống',
      screen_name: tc.screen_name || defaults.screen || 'Danh sách & Chi tiết',
      functional_area: tc.functional_area || defaults.functional || 'Nghiệp vụ chung',
      steps: stepsFormatted,
      account: tc.account || tc.role || 'Nhân viên',
      preconditions_test_data: tc.preconditions_test_data || tc.preconditions || 'Dữ liệu môi trường test',
      expected_result: tc.expected_result || tc.expected || '',
      actual_result: tc.actual_result || '',
      image_video_ref: tc.image_video_ref || '',
      status: (tc.status || 'UNTESTED').toUpperCase(),
      notes: tc.notes || '',
      requirement_refs: tc.requirement_refs || []
    };
  }

  /**
   * Export an array of test cases to Markdown table compliant with the 16 columns
   */
  static toMarkdownTable(testCases) {
    const headers = [
      'Link Task', 'ID', 'Test Type', 'Platform', 'Test objective', 'Module', 
      'Screen', 'Functional', 'Steps', 'Account', 'Precondition / Test Data', 
      'Expected Result', 'Actual Result', 'Image / Video', 'Status', 'Note'
    ];

    const lines = [];
    lines.push(`| ${headers.join(' | ')} |`);
    lines.push(`| ${headers.map(() => '---').join(' | ')} |`);

    testCases.forEach(tc => {
      const clean = str => (str || '').toString().replace(/[\r\n]+/g, '<br>').replace(/\|/g, '\\|');
      const row = [
        clean(tc.link_task),
        clean(tc.case_key),
        clean(tc.test_type),
        clean(tc.platform),
        clean(tc.objective),
        clean(tc.module_name),
        clean(tc.screen_name),
        clean(tc.functional_area),
        clean(tc.steps),
        clean(tc.account),
        clean(tc.preconditions_test_data),
        clean(tc.expected_result),
        clean(tc.actual_result),
        clean(tc.image_video_ref),
        clean(tc.status),
        clean(tc.notes)
      ];
      lines.push(`| ${row.join(' | ')} |`);
    });

    return lines.join('\n');
  }
}
