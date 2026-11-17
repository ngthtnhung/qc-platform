-- ====================================================================
-- Internal AI QA Testing Platform - Initial Seeds Data
-- Version: 1.0 (25/10/2026)
-- ====================================================================

-- 1. Users
INSERT OR IGNORE INTO users (id, display_name, email, role, is_active) VALUES
('usr_qc_lead', 'QC Tester (Me)', 'qc.tester@erp.local', 'QC', 1),
('usr_dev_chau', 'Lê Vĩnh Ngọc Châu', 'chau.le@erp.local', 'DEV', 1),
('usr_po_anh', 'Lê Anh (Product Owner)', 'po.anh@erp.local', 'PO', 1),
('usr_cx_ngoc', 'Ngọc (Customer Experience)', 'cx.ngoc@erp.local', 'CX', 1);

-- 2. Projects
INSERT OR IGNORE INTO projects (id, external_project_key, name, is_active) VALUES
('proj_erp', 'ERP_CORE', 'ERP & SaaS Enterprise Platform', 1);

-- 3. Modules
INSERT OR IGNORE INTO modules (id, code, name, project_id, is_active) VALUES
('mod_maint', 'MAINT', 'Bảo trì thiết bị & hạ tầng', 'proj_erp', 1),
('mod_sales', 'SALES', 'Bán hàng & Quản lý đơn hàng', 'proj_erp', 1),
('mod_inv', 'INV', 'Quản lý kho & Chuyển hàng liên vùng', 'proj_erp', 1);

-- 4. Module Ownerships
INSERT OR IGNORE INTO module_ownerships (id, module_id, role_code, user_id, external_assignee_id, effective_from) VALUES
('own_maint_dev', 'mod_maint', 'DEV', 'usr_dev_chau', 'dev_chau_le', '2026-01-01'),
('own_maint_qc', 'mod_maint', 'QC', 'usr_qc_lead', 'qc_tester', '2026-01-01'),
('own_sales_qc', 'mod_sales', 'QC', 'usr_qc_lead', 'qc_tester', '2026-01-01'),
('own_inv_qc', 'mod_inv', 'QC', 'usr_qc_lead', 'qc_tester', '2026-01-01');

-- 5. Environment Profiles
INSERT OR IGNORE INTO environment_profiles (id, name, base_url, login_url, environment_type, allowed_actions, requires_org_confirmation, org_identifier) VALUES
('env_staging', 'Môi trường Staging', 'https://staging.erp-saas.com', 'https://staging.erp-saas.com/login', 'STAGING', '["READ", "WRITE", "REPRODUCE", "AUTOMATE"]', 0, 'staging-org'),
('env_prod_test', 'Môi trường Production (Org Test)', 'https://app.erp-saas.com/org/test-org', 'https://app.erp-saas.com/login', 'PRODUCTION_TEST', '["READ", "REPRODUCE_READ_ONLY"]', 1, 'production-test-org'),
('env_task_system', 'Hệ thống Quản lý Task & CX', 'https://app.erp-saas.com/org/cx-tickets', 'https://app.erp-saas.com/login', 'TASK_SYSTEM', '["READ_TASK", "WRITE_TASK", "COMMENT"]', 0, 'cx-task-org');

-- 6. Account Profiles
INSERT OR IGNORE INTO account_profiles (id, owner_user_id, name, role, environment_profile_id, username_ref, secret_ref, expected_org_ref, default_route) VALUES
('acc_maint_chau', 'usr_dev_chau', 'Lê Vĩnh Ngọc Châu (Kỹ thuật)', 'Nhân viên bảo trì', 'env_staging', 'chau.le@staging.erp.local', 'ENC_ChauLe#2026', 'staging-org', '/maintenance/tickets'),
('acc_stg_sales_rep', 'usr_qc_lead', 'Sales Rep (Staging)', 'Sales Representative', 'env_staging', 'sales.rep@staging.erp.local', 'ENC_SalesRep#Staging2026', 'staging-org', '/sales/orders'),
('acc_stg_sales_mgr', 'usr_qc_lead', 'Sales Manager (Staging)', 'Sales Manager', 'env_staging', 'sales.manager@staging.erp.local', 'ENC_SalesMgr#Staging2026', 'staging-org', '/sales/orders'),
('acc_stg_warehouse', 'usr_qc_lead', 'Warehouse Ops (Staging)', 'Warehouse Operator', 'env_staging', 'warehouse.ops@staging.erp.local', 'ENC_StockOps#Staging2026', 'staging-org', '/inventory/transfers'),
('acc_prod_sales_rep', 'usr_qc_lead', 'Sales Rep (Prod Org Test)', 'Sales Representative', 'env_prod_test', 'sales.rep@testorg.erp.com', 'ENC_ProdTestSales#2026', 'production-test-org', '/sales/orders'),
('acc_ticket_qc', 'usr_qc_lead', 'QC Lead (Ticket System Org)', 'QC Tester', 'env_task_system', 'qc.tester@erp-saas.com', 'ENC_QCPassword#2026', 'cx-task-org', '/org/cx-tickets');

-- 7. Knowledge Sources & Chunks (Module Bảo Trì Business Rules)
INSERT OR IGNORE INTO knowledge_sources (id, source_type, title, module_id, source_uri, version, owner_user_id, status) VALUES
('src_rule_maint_01', 'TEXT', 'Quy tắc nghiệp vụ 4 độ ưu tiên & Migration data module Bảo trì', 'mod_maint', 'internal://rules/maint/priorities-v2', '2.0', 'usr_po_anh', 'ACTIVE');

INSERT OR IGNORE INTO knowledge_chunks (id, source_id, content_text, chunk_index, metadata) VALUES
('chk_maint_01', 'src_rule_maint_01', 
'Quy tắc thiết lập độ ưu tiên module Bảo trì:
1. Có 4 mức độ ưu tiên: Thấp, Trung bình, Cao, Khẩn cấp.
2. Quy tắc tạo phiếu: Phiếu mới tạo sẽ để độ ưu tiên mặc định là Trung bình (trước đây là Không ưu tiên).
3. Mapping dữ liệu cũ: "Không ưu tiên" => "Trung bình", "Ưu tiên" => "Cao".
4. View xem chi tiết: Ẩn thông tin về độ ưu tiên ở view xem (bỏ hiển thị độ ưu tiên).
5. Danh sách xử lý phiếu: Cập nhật icon hiển thị độ ưu tiên cho cả DESKTOP và MOBILE theo design của Vinh.
6. Bộ lọc (Filter): Bổ sung đầy đủ 4 mức ưu tiên mới.
7. Màn hình thiết lập độ ưu tiên mặc định: Xem link Figma thiết lập https://www.figma.com/design/bJSGiVyt82d2msMWXAYVqd/
8. Migration function: Chuẩn bị sẵn function migrate data từ không ưu tiên thành trung bình, và ưu tiên thành cao.',
0, '{"module":"MAINT", "topic":"Priorities and Migration", "author":"Le Anh PO"}');

-- 8. Sample External Tasks
INSERT OR IGNORE INTO external_tasks (id, external_task_id, external_url, project_id, module_id, task_type, title, description, external_status, priority, due_at) VALUES
('task_ext_maint_502', 'MAINT-502', 'https://app.erp-saas.com/org/cx-tickets/MAINT-502', 'proj_erp', 'mod_maint', 'FUNCTION', 
'[FUNCTION MAINT-502] Điều chỉnh độ ưu tiên phiếu bảo trì & Thiết lập mặc định (Desktop & Mobile)',
'Người thực hiện: Lê Vĩnh Ngọc Châu
Trạng thái: Hoàn thành
Thời gian thực hiện: 8/4 - 15/5
Mô tả:
Để 4 độ ưu tiên: Thấp, Trung bình, Cao, Khẩn cấp
Mapping với data hiện tại: Không ưu tiên => Trung bình, Ưu tiên => Cao
Các trang thông tin cần điều chỉnh (desktop và mobile):
- Tạo phiếu: bổ sung các lựa chọn độ ưu tiên mới. Mặc định là Không ưu tiên
- Danh sách/Chi tiết phiếu view Xem: Không hiển thị thông tin về độ ưu tiên ở view xem
- Danh sách xử lý phiếu: cập nhật icon hiển thị độ ưu tiên của phiếu theo design của Vinh (DESKTOP VS MOBILE)
- Ở filter: bổ sung các loại độ ưu tiên mới
- Chi tiết xử lý phiếu: (DESKTOP VS MOBILE)
- Bổ sung chức năng thiết lập độ ưu tiên mặc định: https://www.figma.com/design/bJSGiVyt82d2msMWXAYVqd/
- Điều chỉnh rule tạo phiếu: Phiếu mới tạo sẽ để độ ưu tiên là Trung bình
- Chuẩn bị sẵn function migrate data từ không ưu tiên thành trung bình, và ưu tiên thành cao.',
'READY_FOR_QC', 'High', '2026-05-15T18:00:00Z');
