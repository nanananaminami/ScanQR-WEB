const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function buildStep(stepName, sort, detailFields) {
  const step = { step_name: stepName, sort };
  detailFields.forEach(f => {
    const defaultVal = f.default || (f.type === 'number' ? 0 : '');
    step['prod_' + f.field_name] = defaultVal;
    step['qc_' + f.field_name] = defaultVal;
  });
  return step;
}

async function authenticate(event) {
  const token = event.session_token;
  if (!token) return { ok: false, code: 'NO_TOKEN', msg: '未登录，请先登录' };
  const sessionRes = await db.collection('sys_sessions').where({
    session_token: token,
    expires_at: _.gt(new Date())
  }).get();
  if (sessionRes.data.length === 0) {
    return { ok: false, code: 'SESSION_EXPIRED', msg: '会话已过期，请重新登录' };
  }
  const session = sessionRes.data[0];
  let user = null;
  try {
    const userRes = await db.collection('sys_users').doc(session.user_id).get();
    user = userRes.data;
  } catch (e) {
    return { ok: false, code: 'USER_NOT_FOUND', msg: '用户不存在' };
  }
  if (!user || user.status === 'disabled') {
    return { ok: false, code: 'DISABLED', msg: '账号已被禁用' };
  }
  const roleRes = await db.collection('sys_roles').where({ role_id: user.role_id }).get();
  const role = roleRes.data[0] || null;
  const permissions = (role && role.permissions) || [];
  db.collection('sys_sessions').doc(session._id).update({
    data: { last_active: db.serverDate() }
  }).catch(() => {});
  return { ok: true, user, role, role_id: user.role_id, permissions, session };
}

const ALL_PERMISSIONS = [
  { perm_id: 'dashboard_view', perm_name: '查看看板', module: 'dashboard' },
  { perm_id: 'card_list', perm_name: '查看在制卡片', module: 'card' },
  { perm_id: 'card_submit', perm_name: '扫码上锁/提交报工', module: 'card' },
  { perm_id: 'card_unlock', perm_name: '强制解锁流转卡', module: 'card' },
  { perm_id: 'card_trace', perm_name: '查看生命周期追溯', module: 'card' },
  { perm_id: 'log_view', perm_name: '查看操作日志', module: 'log' },
  { perm_id: 'log_export', perm_name: '导出日志', module: 'log' },
  { perm_id: 'user_manage', perm_name: '人员管理', module: 'user' },
  { perm_id: 'role_manage', perm_name: '角色与权限管理', module: 'role' },
  { perm_id: 'template_manage', perm_name: '流程卡模板管理', module: 'template' },
  { perm_id: 'seed_init', perm_name: '初始化测试数据', module: 'system' }
];

const SEED_ROLES = [
  {
    role_id: 'admin',
    role_name: '系统管理员',
    permissions: ALL_PERMISSIONS.map(p => p.perm_id),
    description: '拥有全部权限',
    is_system: true
  },
  {
    role_id: 'operator',
    role_name: '操作员',
    permissions: ['card_submit'],
    description: '仅可扫码报工',
    is_system: true
  },
  {
    role_id: 'qc',
    role_name: '质检员',
    permissions: ['card_submit', 'card_trace'],
    description: '扫码报工 + 查看追溯',
    is_system: true
  }
];

// 标准流转卡模板：表头 + 明细列
const DEFAULT_TEMPLATE = {
  template_id: 'TPL_FLOW_01',
  template_name: '标准流转卡模板',
  header_fields: [
    { field_name: 'project_name', label: '项目名称', type: 'input', required: true, sort: 1, placeholder: '如 G2556C-L', default: '' },
    { field_name: 'order_date', label: '开单日期', type: 'input', required: false, sort: 2, placeholder: '如 2026-07-14', default: '' },
    { field_name: 'due_date', label: '计划交期', type: 'datetime', required: false, sort: 3, placeholder: '点击记录', default: '' }
  ],
  detail_fields: [
    { field_name: 'equipment_no', label: '设备编号', type: 'input', required: false, sort: 1, width: 180, placeholder: '-', default: '' },
    { field_name: 'fixture_no', label: '夹具号', type: 'input', required: false, sort: 2, width: 150, placeholder: '-', default: '' },
    { field_name: 'output_qty', label: '产出量', type: 'number', required: false, sort: 3, width: 130, placeholder: '0', default: '0' },
    { field_name: 'completion_time', label: '作业完时间', type: 'datetime', required: false, sort: 4, width: 180, placeholder: '点击记录', default: '' },
    { field_name: 'operator', label: '作业人员', type: 'input', required: false, sort: 5, width: 150, placeholder: '-', default: '' },
    { field_name: 'remark', label: '备注', type: 'textarea', required: false, sort: 6, width: 160, placeholder: '-', default: '' }
  ]
};

exports.main = async (event, context) => {
  const results = { success: true, created: [], skipped: [] };

  try {
    const userCountRes = await db.collection('sys_users').count();
    if (userCountRes.total > 0) {
      const auth = await authenticate(event);
      if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
      if (auth.permissions.indexOf('seed_init') === -1) {
        return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 seed_init 权限' };
      }
    }

    for (const p of ALL_PERMISSIONS) {
      const exist = await db.collection('sys_permissions').where({ perm_id: p.perm_id }).get();
      if (exist.data.length === 0) {
        await db.collection('sys_permissions').add({
          data: Object.assign({}, p, { created_at: db.serverDate() })
        });
        results.created.push('sys_permissions: ' + p.perm_id);
      } else {
        results.skipped.push('sys_permissions: ' + p.perm_id);
      }
    }

    for (const r of SEED_ROLES) {
      const exist = await db.collection('sys_roles').where({ role_id: r.role_id }).get();
      if (exist.data.length === 0) {
        await db.collection('sys_roles').add({
          data: Object.assign({}, r, { created_at: db.serverDate() })
        });
        results.created.push('sys_roles: ' + r.role_id);
      } else {
        await db.collection('sys_roles').doc(exist.data[0]._id).update({
          data: {
            permissions: r.permissions,
            role_name: r.role_name,
            description: r.description,
            is_system: true,
            updated_at: db.serverDate()
          }
        });
        results.skipped.push('sys_roles: ' + r.role_id + '（已刷新权限）');
      }
    }

    const adminExist = await db.collection('sys_users').where({ username: 'admin' }).get();
    if (adminExist.data.length === 0) {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword('admin123', salt);
      await db.collection('sys_users').add({
        data: {
          username: 'admin',
          password_salt: salt,
          password_hash: hash,
          role_id: 'admin',
          real_name: '系统管理员',
          department: '信息部',
          phone: '',
          status: 'active',
          created_at: db.serverDate(),
          last_login: null
        }
      });
      results.created.push('sys_users: admin / admin123');
    } else {
      results.skipped.push('sys_users: admin 已存在');
    }

    const SEED_DICTS = [
      { dict_id: 'process_type', dict_name: '制程类型', options: ['开始注塑', '保压成型', '冷却定型', '开模取件'] },
      { dict_id: 'defect_reason', dict_name: '不良原因', options: ['气泡', '缺料', '飞边', '变形', '尺寸超差'] },
      { dict_id: 'process_list', dict_name: '工序列表', options: ['压印', '光刻', '镀AR', '镀Ti', '去胶撕膜', '去胶清洗', '切割', '冲压', '折弯', '焊接', '喷涂', '组装', '测试', '车削', '铣削', '磨削', '电镀', '包装', '注塑', 'CNC加工', '抛光', '清洗', '烘干', '打标', '目检', '全检', '成品入库'] }
    ];
    for (const d of SEED_DICTS) {
      const existDict = await db.collection('sys_dicts').where({ dict_id: d.dict_id }).get();
      if (existDict.data.length === 0) {
        await db.collection('sys_dicts').add({
          data: Object.assign({}, d, { created_at: db.serverDate() })
        });
        results.created.push('sys_dicts: ' + d.dict_id);
      } else {
        results.skipped.push('sys_dicts: ' + d.dict_id);
      }
    }

    // 初始化标准模板
    const existTpl = await db.collection('process_templates').where({ template_id: DEFAULT_TEMPLATE.template_id }).get();
    if (existTpl.data.length === 0) {
      await db.collection('process_templates').add({
        data: Object.assign({}, DEFAULT_TEMPLATE, {
          created_at: db.serverDate(),
          updated_at: db.serverDate(),
          created_by: 'system'
        })
      });
      results.created.push('process_templates: ' + DEFAULT_TEMPLATE.template_id);
    } else {
      results.skipped.push('process_templates: ' + DEFAULT_TEMPLATE.template_id + ' 已存在');
    }

    // 初始化测试流转卡
    const detailFields = DEFAULT_TEMPLATE.detail_fields;
    const seedCards = [
      {
        order_no: 'A260130011',
        header_data: { project_name: 'G2556C-L', order_date: '2026-07-14' },
        stepNames: ['压印', '光刻', '镀AR', '镀Ti', '去胶撕膜', '去胶清洗', '切割']
      },
      {
        order_no: 'A260130012',
        header_data: { project_name: 'G2556D-M', order_date: '2026-07-14' },
        stepNames: ['冲压', '折弯', '焊接', '喷涂', '组装', '测试']
      }
    ];

    for (const c of seedCards) {
      const existCard = await db.collection('process_cards').where({ order_no: c.order_no }).get();
      if (existCard.data.length === 0) {
        const builtSteps = c.stepNames.map((name, i) => buildStep(name, i + 1, detailFields));
        const cardRes = await db.collection('process_cards').add({
          data: {
            order_no: c.order_no,
            template_id: DEFAULT_TEMPLATE.template_id,
            header_data: c.header_data,
            steps: builtSteps,
            warehouse_personnel: '',
            warehouse_date: '',
            status: '加工中',
            is_locked: false,
            locked_by: '',
            locked_by_user_id: '',
            lock_time: null,
            created_at: db.serverDate()
          }
        });
        results.created.push({ collection: 'process_cards', id: cardRes._id, order_no: c.order_no });
      } else {
        results.skipped.push('process_cards: ' + c.order_no + ' 已存在');
      }
    }

    results.msg = '初始化完成。默认管理员：admin / admin123。测试工单：A260130011（7道工序）、A260130012（6道工序）。模板：TPL_FLOW_01';
    return results;
  } catch (err) {
    return { success: false, msg: '初始化失败：' + (err.errMsg || err.message || '未知错误'), error: err };
  }
};
