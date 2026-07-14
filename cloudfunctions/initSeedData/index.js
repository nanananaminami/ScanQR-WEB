const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
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

// 系统权限目录
const ALL_PERMISSIONS = [
  { perm_id: 'dashboard_view', perm_name: '查看看板', module: 'dashboard' },
  { perm_id: 'card_list', perm_name: '查看在制卡片', module: 'card' },
  { perm_id: 'card_submit', perm_name: '扫码上锁/提交报工', module: 'card' },
  { perm_id: 'card_unlock', perm_name: '强制解锁流程卡', module: 'card' },
  { perm_id: 'card_trace', perm_name: '查看生命周期追溯', module: 'card' },
  { perm_id: 'log_view', perm_name: '查看操作日志', module: 'log' },
  { perm_id: 'log_export', perm_name: '导出日志', module: 'log' },
  { perm_id: 'user_manage', perm_name: '人员管理', module: 'user' },
  { perm_id: 'role_manage', perm_name: '角色与权限管理', module: 'role' },
  { perm_id: 'template_manage', perm_name: '流程卡模板管理', module: 'template' },
  { perm_id: 'seed_init', perm_name: '初始化测试数据', module: 'system' }
];

// 内置角色
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

exports.main = async (event, context) => {
  const results = { success: true, created: [], skipped: [] };

  try {
    // 鉴权：初始化为敏感操作，需登录且拥有 seed_init 权限
    // 首次部署时 sys_users 为空，无法登录，故允许「无用户时免鉴权执行」作为 bootstrap
    const userCountRes = await db.collection('sys_users').count();
    if (userCountRes.total > 0) {
      const auth = await authenticate(event);
      if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
      if (auth.permissions.indexOf('seed_init') === -1) {
        return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 seed_init 权限' };
      }
    }

    // 1. 初始化权限目录
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

    // 2. 初始化角色（已存在则刷新权限，保持幂等）
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

    // 3. 初始化默认管理员账号 admin / admin123
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

    // 4. 初始化质检工段模板
    const existingTpl = await db.collection('process_templates').where({ template_id: 'TPL_QC_01' }).get();
    if (existingTpl.data.length === 0) {
      const tplRes = await db.collection('process_templates').add({
        data: {
          template_id: 'TPL_QC_01',
          template_name: '质检工段填报模板',
          step_name: '质检工段',
          fields: [
            { field_name: 'outer_diameter', label: '外径尺寸', type: 'number', required: true, unit: 'mm' },
            { field_name: 'inner_diameter', label: '内径尺寸', type: 'number', required: true, unit: 'mm' },
            { field_name: 'thickness', label: '壁厚', type: 'number', required: false, unit: 'mm' },
            { field_name: 'appearance_result', label: '外观检查结果', type: 'radio', required: true, options: ['合格', '返修', '报废'] },
            { field_name: 'surface_defect', label: '表面缺陷描述', type: 'textarea', required: false },
            { field_name: 'need_rework', label: '是否需要返工', type: 'switch', required: false }
          ],
          created_at: db.serverDate()
        }
      });
      results.created.push({ collection: 'process_templates', id: tplRes._id });
    } else {
      results.skipped.push('process_templates: TPL_QC_01 已存在');
    }

    // 5. 初始化测试流程卡
    const seedCards = [
      { card_no: 'WO-20260712-01', prod_name: '轴承外圈加工', current_step: '质检工段', template_id: 'TPL_QC_01' },
      { card_no: 'WO-20260712-02', prod_name: '轴承内圈加工', current_step: '质检工段', template_id: 'TPL_QC_01' },
      { card_no: 'WO-20260712-03', prod_name: '注塑样件-低代码演示', current_step: '注塑工段', template_id: 'TPL_INJECT_01' }
    ];
    for (const c of seedCards) {
      const existCard = await db.collection('process_cards').where({ card_no: c.card_no }).get();
      if (existCard.data.length === 0) {
        const cardRes = await db.collection('process_cards').add({
          data: {
            card_no: c.card_no,
            prod_name: c.prod_name,
            current_step: c.current_step,
            template_id: c.template_id,
            status: '加工中',
            is_locked: false,
            locked_by: '',
            locked_by_user_id: '',
            lock_time: null,
            created_at: db.serverDate()
          }
        });
        results.created.push({ collection: 'process_cards', id: cardRes._id, card_no: c.card_no });
      } else {
        results.skipped.push('process_cards: ' + c.card_no + ' 已存在');
      }
    }

    // 6. 初始化数据字典（下拉选项库）
    const SEED_DICTS = [
      { dict_id: 'process_type', dict_name: '制程类型', options: ['开始注塑', '保压成型', '冷却定型', '开模取件'] },
      { dict_id: 'defect_reason', dict_name: '不良原因', options: ['气泡', '缺料', '飞边', '变形', '尺寸超差'] }
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

    // 7. 初始化低代码样例模板（注塑工段，演示 input/number/select/datetime/textarea）
    const existInject = await db.collection('process_templates').where({ template_id: 'TPL_INJECT_01' }).get();
    if (existInject.data.length === 0) {
      await db.collection('process_templates').add({
        data: {
          template_id: 'TPL_INJECT_01',
          template_name: '注塑工段填报模板',
          step_name: '注塑工段',
          fields: [
            { field_name: 'process_type', label: '制程类型', type: 'select', required: true, dict_id: 'process_type', options: [], unit: '', placeholder: '请选择', default: '' },
            { field_name: 'input_qty', label: '投入数量', type: 'number', required: true, unit: '件', placeholder: '请输入', default: '' },
            { field_name: 'ok_qty', label: '良品数量', type: 'number', required: true, unit: '件', placeholder: '请输入', default: '' },
            { field_name: 'defect_reason', label: '不良原因', type: 'select', required: false, dict_id: 'defect_reason', options: [], unit: '', placeholder: '请选择', default: '' },
            { field_name: 'operate_time', label: '操作时间', type: 'datetime', required: false, auto_now: true, unit: '', placeholder: '自动记录', default: '' },
            { field_name: 'remark', label: '备注', type: 'textarea', required: false, unit: '', placeholder: '请输入', default: '' }
          ],
          created_at: db.serverDate(),
          updated_at: db.serverDate(),
          created_by: 'system'
        }
      });
      results.created.push('process_templates: TPL_INJECT_01（低代码样例）');
    } else {
      results.skipped.push('process_templates: TPL_INJECT_01 已存在');
    }

    results.msg = '初始化完成。默认管理员：admin / admin123。测试卡号：WO-20260712-01/02（质检）、WO-20260712-03（注塑低代码演示）';
    return results;
  } catch (err) {
    return { success: false, msg: '初始化失败：' + (err.errMsg || err.message || '未知错误'), error: err };
  }
};
