/**
 * Test Suite: nhãn trạng thái, độ ưu tiên, ngày Today và ảnh bug realtime
 */
import assert from 'node:assert';
import { statusLabel, priorityLabel, priorityRank, CLOSED_STATUS, todayVN } from '../packages/bug-search/codes.js';
import { fetchBugImages } from '../packages/haraworks-live/detail.js';

export async function runBugLabelTests() {
  console.log('\n--- Running Bug Label Tests ---');
  assert.strictEqual(statusLabel(0), 'Mới');
  assert.notStrictEqual(statusLabel(0), 'Chưa bắt đầu');
  assert.strictEqual(statusLabel(3), 'Chờ duyệt');
  assert.strictEqual(statusLabel(11), 'Không thực hiện');
  assert.strictEqual(statusLabel(null), '');
  assert.ok(CLOSED_STATUS.has(5) && CLOSED_STATUS.has(11) && !CLOSED_STATUS.has(1));
  console.log('✓ Test 1 Passed: nhãn trạng thái theo giao diện Haraworks');

  assert.strictEqual(priorityLabel(1), 'Ưu tiên cao');
  assert.strictEqual(priorityLabel(2), 'Ưu tiên cao');
  assert.strictEqual(priorityLabel(3), 'Ưu tiên');
  assert.strictEqual(priorityLabel(4), 'Không ưu tiên');
  assert.ok(priorityRank(1) < priorityRank(3) && priorityRank(3) < priorityRank(4) && priorityRank(4) < priorityRank(undefined));
  console.log('✓ Test 2 Passed: độ ưu tiên và thứ tự sắp xếp');

  // 00:30 ngày 18/11 giờ VN là 17:30 ngày 17/11 UTC, vẫn phải tính là ngày 18
  assert.strictEqual(todayVN(Date.parse('2026-11-17T17:30:00Z')), '2026-11-18');
  assert.strictEqual(todayVN(Date.parse('2026-11-18T16:59:00Z')), '2026-11-18');
  assert.strictEqual(todayVN(Date.parse('2026-11-18T17:00:00Z')), '2026-11-19');
  console.log('✓ Test 3 Passed: ngày hôm nay theo giờ Việt Nam');

  assert.strictEqual(typeof fetchBugImages, 'function');
  await assert.rejects(() => fetchBugImages('khong-hop-le'), /Mã bug không hợp lệ/);
  console.log('✓ Test 4 Passed: fetchBugImages từ chối mã bug sai');
}
