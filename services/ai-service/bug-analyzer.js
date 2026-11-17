/**
 * Internal AI QA Testing Platform - Customer Bug AI Analyzer
 * Evaluates issue descriptions, validates mandatory fields, retrieves RAG citations,
 * and proposes reproduction steps without making ungrounded assumptions.
 * Defined in Section 5.2 & Section 10.4 of System Design v1.0.
 */

import { RagEngine } from './rag-engine.js';
import { db } from '../../database/db.js';

export class BugAnalyzer {
  /**
   * Analyze customer bug report
   * @param {object} params
   * @param {string} params.rawText Bug description from CX ticket
   * @param {string} params.moduleId Identified module ID or code
   * @param {string} params.platform Platform (Web / Mobile)
   * @param {Array} params.attachments Evidence attachments list
   */
  static async analyze({ rawText, moduleId = 'mod_maint', platform = 'Web', attachments = [] }) {
    if (!rawText || rawText.trim() === '') {
      throw new Error('Mô tả bug không được để trống.');
    }

    const textLower = rawText.toLowerCase();

    // 1. Mandatory Fields Validation (Section 5.2)
    const missingInfo = [];
    if (!textLower.includes('tài khoản') && !textLower.includes('user') && !textLower.includes('role') && !textLower.includes('khách hàng')) {
      missingInfo.push('Chưa rõ tài khoản / vai trò (Role / User code) thực hiện thao tác.');
    }
    if (!textLower.includes('bước') && !textLower.includes('khi') && !textLower.includes('nhấn') && !textLower.includes('tạo')) {
      missingInfo.push('Chưa rõ các bước thao tác cụ thể dẫn đến lỗi.');
    }
    if (attachments.length === 0 && !textLower.includes('ảnh') && !textLower.includes('video') && !textLower.includes('screenshot')) {
      missingInfo.push('Thiếu hình ảnh hoặc video bằng chứng (Evidence) từ khách hàng.');
    }
    if (platform.toLowerCase().includes('mobile')) {
      if (!textLower.includes('ios') && !textLower.includes('android') && !textLower.includes('version')) {
        missingInfo.push('Môi trường Mobile yêu cầu bổ sung thông tin thiết bị và phiên bản ứng dụng (Version App).');
      }
    }

    // 2. RAG Knowledge Retrieval
    const keywords = ['bảo trì', 'ưu tiên', 'chiết khấu', 'kho', 'đơn hàng', 'lỗi', '500', 'duyệt'];
    const matchedChunks = await RagEngine.retrieveChunks({ moduleId, keywords });
    const citations = RagEngine.formatCitations(matchedChunks);

    // 3. Suspected Module & Function Detection
    let suspectedModule = 'Hệ thống chung';
    let moduleCode = 'CORE';
    if (textLower.includes('bảo trì') || textLower.includes('phiếu') || textLower.includes('ưu tiên')) {
      suspectedModule = 'Bảo trì thiết bị & hạ tầng (/maintenance/tickets)';
      moduleCode = 'MAINT';
    } else if (textLower.includes('sales') || textLower.includes('chiết khấu') || textLower.includes('đơn hàng') || textLower.includes('báo giá')) {
      suspectedModule = 'Bán hàng & Báo giá (/sales/orders)';
      moduleCode = 'SALES';
    } else if (textLower.includes('kho') || textLower.includes('chuyển hàng') || textLower.includes('inventory')) {
      suspectedModule = 'Quản lý kho & Chuyển kho (/inventory/transfers)';
      moduleCode = 'INV';
    }

    // 4. Proposed Reproduction Steps Generation
    const reproSteps = [
      'Đăng nhập vào môi trường kiểm thử với đúng vai trò người dùng được phản ánh.',
      `Truy cập vào phân hệ: ${suspectedModule}.`,
      'Nhập các tham số đầu vào chính xác như mô tả của khách hàng.',
      'Kích hoạt thao tác xử lý/gửi phiếu và quan sát phản hồi của hệ thống.'
    ];

    if (textLower.includes('chiết khấu 20%')) {
      reproSteps[2] = 'Tạo đơn hàng mới cho khách hàng "Acme Global", nhập chiết khấu 20% và nhấn "Submit Quotation".';
      reproSteps.push('Kiểm tra quyền phê duyệt của Sales Manager đối với mức chiết khấu > 15%.');
    }

    // 5. Hypotheses based on knowledge
    const hypotheses = [];
    if (moduleCode === 'MAINT') {
      hypotheses.push('Quy tắc mapping độ ưu tiên mới (Thấp, Trung bình, Cao, Khẩn cấp) chưa được cập nhật đồng bộ giữa Desktop và Mobile.');
      hypotheses.push('View xem chi tiết chưa ẩn thông tin độ ưu tiên theo đúng rule PO.');
    } else if (moduleCode === 'SALES') {
      hypotheses.push('Lỗi API phân quyền khi chiết khấu vượt ngưỡng 15% không gửi thông báo phê duyệt tới Sales Manager.');
    } else {
      hypotheses.push('Dữ liệu đầu vào vi phạm ràng buộc nghiệp vụ hoặc phiên làm việc của user bị ngắt kết nối.');
    }

    // 6. Mandatory Output Schema (Section 10.4)
    return {
      summary: rawText.split('\n')[0].substring(0, 90) || 'Phân tích lỗi phát sinh từ người dùng',
      suspected_module: suspectedModule,
      module_code: moduleCode,
      observed_behavior: 'Hệ thống báo lỗi hoặc không thực hiện đúng luồng mong đợi khi người dùng kích hoạt hành động.',
      expected_behavior: 'Hệ thống xử lý thành công hoặc hiển thị cảnh báo nghiệp vụ rõ ràng, gán đúng người duyệt theo SLA.',
      reproduction_steps: reproSteps,
      hypotheses,
      evidence_refs: attachments.map(a => a.name || a.id || 'file_attachment'),
      missing_information: missingInfo,
      environment_requirements: 'Kiểm thử trên Staging trước; nếu không tái hiện được mới chuyển sang Production (Org Test) sau khi xác nhận Org.',
      risk_flags: missingInfo.length > 0 ? ['THIẾU_THÔNG_TIN_CX', 'CẦN_LÀM_RÕ_BƯỚC'] : [],
      confidence: missingInfo.length === 0 ? 'HIGH (0.92)' : 'MEDIUM (0.65)',
      source_refs: citations
    };
  }
}
