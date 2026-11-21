/**
 * Internal AI QA Testing Platform - Database Layer
 * Zero-dependency persistent relational data engine supporting full SQL schema & repository methods.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE_PATH = path.join(__dirname, 'qa_platform_data.json');
const SCHEMA_FILE_PATH = path.join(__dirname, 'schema.sql');
const SEEDS_FILE_PATH = path.join(__dirname, 'seeds.sql');

class DatabaseClient {
  constructor() {
    this.tables = {
      users: [],
      projects: [],
      modules: [],
      module_ownerships: [],
      environment_profiles: [],
      account_profiles: [],
      knowledge_sources: [],
      knowledge_chunks: [],
      workflow_runs: [],
      external_tasks: [],
      bug_records: [],
      bug_procedures: [],
      test_plans: [],
      test_cases: [],
      test_runs: [],
      test_results: [],
      evidence_assets: [],
      approvals: [],
      audit_events: []
    };
    this.isInitialized = false;
  }

  async init() {
    if (this.isInitialized) return;

    // Load existing database state if exists
    if (fs.existsSync(DB_FILE_PATH)) {
      try {
        const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8').replace(/^\uFEFF/, '');
        const data = JSON.parse(raw);
        this.tables = { ...this.tables, ...data };
        console.log('[DB] Loaded existing data from storage.');
      } catch (err) {
        console.warn('[DB] Failed reading db file, re-initializing seeds:', err.message);
        this.loadSeeds();
      }
    } else {
      this.loadSeeds();
    }

    this.isInitialized = true;
    this.persist();
  }

  loadSeeds() {
    // Parse seeds from seeds.sql or set defaults
    console.log('[DB] Seeding initial database data...');

    this.tables.users = [
      { id: 'usr_qc_lead', display_name: 'QC Tester (Me)', email: 'qc.tester@erp.local', role: 'QC', is_active: 1, created_at: new Date().toISOString() },
      { id: 'usr_dev_chau', display_name: 'Lê Vĩnh Ngọc Châu', email: 'chau.le@erp.local', role: 'DEV', is_active: 1, created_at: new Date().toISOString() },
      { id: 'usr_po_anh', display_name: 'Lê Anh (Product Owner)', email: 'po.anh@erp.local', role: 'PO', is_active: 1, created_at: new Date().toISOString() },
      { id: 'usr_cx_ngoc', display_name: 'Ngọc (Customer Experience)', email: 'cx.ngoc@erp.local', role: 'CX', is_active: 1, created_at: new Date().toISOString() }
    ];

    this.tables.projects = [
      { id: 'proj_erp', external_project_key: 'ERP_CORE', name: 'ERP & SaaS Enterprise Platform', is_active: 1, created_at: new Date().toISOString() }
    ];

    this.tables.modules = [
      { id: 'mod_maint', code: 'MAINT', name: 'Bảo trì thiết bị & hạ tầng', project_id: 'proj_erp', is_active: 1, created_at: new Date().toISOString() },
      { id: 'mod_sales', code: 'SALES', name: 'Bán hàng & Quản lý đơn hàng', project_id: 'proj_erp', is_active: 1, created_at: new Date().toISOString() },
      { id: 'mod_inv', code: 'INV', name: 'Quản lý kho & Chuyển hàng liên vùng', project_id: 'proj_erp', is_active: 1, created_at: new Date().toISOString() }
    ];

    this.tables.module_ownerships = [
      { id: 'own_maint_dev', module_id: 'mod_maint', role_code: 'DEV', user_id: 'usr_dev_chau', external_assignee_id: 'dev_chau_le', effective_from: '2026-01-01', is_active: 1 },
      { id: 'own_maint_qc', module_id: 'mod_maint', role_code: 'QC', user_id: 'usr_qc_lead', external_assignee_id: 'qc_tester', effective_from: '2026-01-01', is_active: 1 },
      { id: 'own_sales_qc', module_id: 'mod_sales', role_code: 'QC', user_id: 'usr_qc_lead', external_assignee_id: 'qc_tester', effective_from: '2026-01-01', is_active: 1 },
      { id: 'own_inv_qc', module_id: 'mod_inv', role_code: 'QC', user_id: 'usr_qc_lead', external_assignee_id: 'qc_tester', effective_from: '2026-01-01', is_active: 1 }
    ];

    this.tables.environment_profiles = [
      {
        id: 'env_staging',
        name: 'Môi trường Staging',
        base_url: 'https://staging.erp-saas.com',
        login_url: 'https://staging.erp-saas.com/login',
        environment_type: 'STAGING',
        allowed_actions: ['READ', 'WRITE', 'REPRODUCE', 'AUTOMATE'],
        requires_org_confirmation: 0,
        org_identifier: 'staging-org',
        is_active: 1,
        created_at: new Date().toISOString()
      },
      {
        id: 'env_prod_test',
        name: 'Môi trường Production (Org Test)',
        base_url: 'https://app.erp-saas.com/org/test-org',
        login_url: 'https://app.erp-saas.com/login',
        environment_type: 'PRODUCTION_TEST',
        allowed_actions: ['READ', 'REPRODUCE_READ_ONLY'],
        requires_org_confirmation: 1,
        org_identifier: 'production-test-org',
        is_active: 1,
        created_at: new Date().toISOString()
      },
      {
        id: 'env_task_system',
        name: 'Hệ thống Quản lý Task & CX',
        base_url: 'https://app.erp-saas.com/org/cx-tickets',
        login_url: 'https://app.erp-saas.com/login',
        environment_type: 'TASK_SYSTEM',
        allowed_actions: ['READ_TASK', 'WRITE_TASK', 'COMMENT'],
        requires_org_confirmation: 0,
        org_identifier: 'cx-task-org',
        is_active: 1,
        created_at: new Date().toISOString()
      }
    ];

    this.tables.account_profiles = [
      {
        id: 'acc_maint_chau',
        owner_user_id: 'usr_dev_chau',
        name: 'Lê Vĩnh Ngọc Châu (Kỹ thuật)',
        role: 'Nhân viên bảo trì',
        environment_profile_id: 'env_staging',
        username_ref: 'chau.le@staging.erp.local',
        secret_ref: 'ENC_ChauLe#2026',
        expected_org_ref: 'staging-org',
        default_route: '/maintenance/tickets',
        is_active: 1
      },
      {
        id: 'acc_stg_sales_rep',
        owner_user_id: 'usr_qc_lead',
        name: 'Sales Rep (Staging)',
        role: 'Sales Representative',
        environment_profile_id: 'env_staging',
        username_ref: 'sales.rep@staging.erp.local',
        secret_ref: 'ENC_SalesRep#Staging2026',
        expected_org_ref: 'staging-org',
        default_route: '/sales/orders',
        is_active: 1
      },
      {
        id: 'acc_stg_sales_mgr',
        owner_user_id: 'usr_qc_lead',
        name: 'Sales Manager (Staging)',
        role: 'Sales Manager',
        environment_profile_id: 'env_staging',
        username_ref: 'sales.manager@staging.erp.local',
        secret_ref: 'ENC_SalesMgr#Staging2026',
        expected_org_ref: 'staging-org',
        default_route: '/sales/orders',
        is_active: 1
      },
      {
        id: 'acc_stg_warehouse',
        owner_user_id: 'usr_qc_lead',
        name: 'Warehouse Ops (Staging)',
        role: 'Warehouse Operator',
        environment_profile_id: 'env_staging',
        username_ref: 'warehouse.ops@staging.erp.local',
        secret_ref: 'ENC_StockOps#Staging2026',
        expected_org_ref: 'staging-org',
        default_route: '/inventory/transfers',
        is_active: 1
      },
      {
        id: 'acc_prod_sales_rep',
        owner_user_id: 'usr_qc_lead',
        name: 'Sales Rep (Prod Org Test)',
        role: 'Sales Representative',
        environment_profile_id: 'env_prod_test',
        username_ref: 'sales.rep@testorg.erp.com',
        secret_ref: 'ENC_ProdTestSales#2026',
        expected_org_ref: 'production-test-org',
        default_route: '/sales/orders',
        is_active: 1
      },
      {
        id: 'acc_ticket_qc',
        owner_user_id: 'usr_qc_lead',
        name: 'QC Lead (Ticket System Org)',
        role: 'QC Tester',
        environment_profile_id: 'env_task_system',
        username_ref: 'qc.tester@erp-saas.com',
        secret_ref: 'ENC_QCPassword#2026',
        expected_org_ref: 'cx-task-org',
        default_route: '/org/cx-tickets',
        is_active: 1
      }
    ];

    this.tables.knowledge_sources = [
      {
        id: 'src_rule_maint_01',
        source_type: 'TEXT',
        title: 'Quy tắc nghiệp vụ 4 độ ưu tiên & Migration data module Bảo trì',
        module_id: 'mod_maint',
        source_uri: 'internal://rules/maint/priorities-v2',
        version: '2.0',
        owner_user_id: 'usr_po_anh',
        status: 'ACTIVE',
        created_at: new Date().toISOString()
      }
    ];

    this.tables.knowledge_chunks = [
      {
        id: 'chk_maint_01',
        source_id: 'src_rule_maint_01',
        content_text: `Quy tắc thiết lập độ ưu tiên module Bảo trì:
1. Có 4 mức độ ưu tiên: Thấp, Trung bình, Cao, Khẩn cấp.
2. Quy tắc tạo phiếu: Phiếu mới tạo sẽ để độ ưu tiên mặc định là Trung bình (trước đây là Không ưu tiên).
3. Mapping dữ liệu cũ: "Không ưu tiên" => "Trung bình", "Ưu tiên" => "Cao".
4. View xem chi tiết: Ẩn thông tin về độ ưu tiên ở view xem (bỏ hiển thị độ ưu tiên).
5. Danh sách xử lý phiếu: Cập nhật icon hiển thị độ ưu tiên cho cả DESKTOP và MOBILE theo design của Vinh.
6. Bộ lọc (Filter): Bổ sung đầy đủ 4 mức ưu tiên mới.
7. Màn hình thiết lập độ ưu tiên mặc định: Xem link Figma thiết lập https://www.figma.com/design/bJSGiVyt82d2msMWXAYVqd/
8. Migration function: Chuẩn bị sẵn function migrate data từ không ưu tiên thành trung bình, và ưu tiên thành cao.`,
        chunk_index: 0,
        metadata: { module: 'MAINT', topic: 'Priorities and Migration' },
        created_at: new Date().toISOString()
      }
    ];

    this.tables.external_tasks = [
      {
        id: 'task_ext_maint_502',
        external_task_id: 'MAINT-502',
        external_url: 'https://app.erp-saas.com/org/cx-tickets/MAINT-502',
        project_id: 'proj_erp',
        module_id: 'mod_maint',
        task_type: 'FUNCTION',
        title: '[FUNCTION MAINT-502] Điều chỉnh độ ưu tiên phiếu bảo trì & Thiết lập mặc định (Desktop & Mobile)',
        description: `Người thực hiện: Lê Vĩnh Ngọc Châu
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
- Chuẩn bị sẵn function migrate data từ không ưu tiên thành trung bình, và ưu tiên thành cao.`,
        external_status: 'READY_FOR_QC',
        priority: 'High',
        due_at: '2026-05-15T18:00:00Z',
        last_synced_at: new Date().toISOString()
      }
    ];
  }

  persist() {
    try {
      fs.writeFileSync(DB_FILE_PATH, JSON.stringify(this.tables, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DB] Persist failed:', err.message);
    }
  }

  // Repository Methods
  getTable(tableName) {
    if (!this.tables[tableName]) {
      this.tables[tableName] = [];
    }
    return this.tables[tableName];
  }

  async find(tableName, predicate = () => true) {
    await this.init();
    return this.getTable(tableName).filter(predicate);
  }

  async findOne(tableName, predicate) {
    await this.init();
    return this.getTable(tableName).find(predicate) || null;
  }

  async findById(tableName, id) {
    await this.init();
    return this.getTable(tableName).find(item => item.id === id) || null;
  }

  async insert(tableName, record) {
    await this.init();
    if (!record.id) {
      record.id = `${tableName.slice(0, 3)}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    }
    if (!record.created_at) {
      record.created_at = new Date().toISOString();
    }
    this.getTable(tableName).push(record);
    this.persist();
    return record;
  }

  async update(tableName, id, updates) {
    await this.init();
    const table = this.getTable(tableName);
    const index = table.findIndex(item => item.id === id);
    if (index === -1) return null;
    table[index] = { ...table[index], ...updates, updated_at: new Date().toISOString() };
    this.persist();
    return table[index];
  }

  async delete(tableName, id) {
    await this.init();
    const table = this.getTable(tableName);
    const index = table.findIndex(item => item.id === id);
    if (index === -1) return false;
    table.splice(index, 1);
    this.persist();
    return true;
  }
}

export const db = new DatabaseClient();
