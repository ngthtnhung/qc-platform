/**
 * Test Suite: 16-Column Test Case Template Schema
 */

import assert from 'node:assert';
import { TestCaseSchemaValidator, MANDATORY_COLUMNS } from '../packages/test-case-schema/validator.js';

export async function runTestCaseSchemaTests() {
  console.log('\n--- Running 16-Column Template Schema Tests ---');

  // Test 1: Check that exactly 16 columns are mandated
  assert.strictEqual(MANDATORY_COLUMNS.length, 16);
  console.log('✓ Test 1 Passed: Exactly 16 mandatory columns verified');

  // Test 2: Normalize and validate complete test case
  const rawTc = {
    case_key: 'TC-MAINT-01',
    link_task: 'MAINT-502',
    test_type: 'Functional',
    platform: 'Web (Desktop & Mobile)',
    objective: 'Kiểm tra mở form Tạo phiếu: Hiển thị 4 độ ưu tiên mới và mặc định Trung bình',
    module_name: 'Bảo trì',
    screen_name: 'Tạo phiếu mới',
    functional_area: 'Tạo phiếu',
    steps: ['1. Vào menu Bảo trì', '2. Bấm Tạo phiếu', '3. Quan sát dropdown'],
    account: 'Lê Vĩnh Ngọc Châu (Kỹ thuật)',
    preconditions_test_data: 'Có quyền bảo trì',
    expected_result: 'Mặc định chọn Trung bình',
    status: 'PASS',
    notes: 'Rule PO mới'
  };

  const normalized = TestCaseSchemaValidator.normalize(rawTc);
  const validation = TestCaseSchemaValidator.validate(normalized);
  assert.strictEqual(validation.isValid, true);
  console.log('✓ Test 2 Passed: Full 16-column test case successfully validated');

  // Test 3: Reject missing mandatory fields
  const invalidTc = {
    case_key: '',
    objective: '',
    steps: '',
    expected_result: '',
    status: 'INVALID_STATUS'
  };
  const invalidResult = TestCaseSchemaValidator.validate(invalidTc);
  assert.strictEqual(invalidResult.isValid, false);
  assert(invalidResult.errors.length >= 4);
  console.log('✓ Test 3 Passed: Invalid fields and illegal status correctly rejected');

  // Test 4: Export to Markdown table
  const markdown = TestCaseSchemaValidator.toMarkdownTable([normalized]);
  assert(markdown.includes('Link Task | ID | Test Type'));
  assert(markdown.includes('TC-MAINT-01'));
  assert(markdown.includes('Lê Vĩnh Ngọc Châu'));
  console.log('✓ Test 4 Passed: 16-column Markdown table generated accurately');
}
