const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

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

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 构建单道工序的 dynamic_step 结构（嵌套 depts：生产 + 品质）
function buildDynamicStep(stepName, sort, detailFields) {
  const deptFields = {};
  detailFields.forEach(f => {
    deptFields[f.field_name] = f.default || (f.type === 'number' ? 0 : '');
  });
  return {
    step_name: stepName,
    sort: sort,
    device_no: '',
    fixture_no: '',
    prod_started_at: null,
    prod_completed_at: null,
    prod_completed_by: null,
    qc_completed_at: null,
    qc_completed_by: null,
    depts: [
      Object.assign({ dept_name: '生产' }, deptFields),
      Object.assign({ dept_name: '品质' }, deptFields)
    ]
  };
}

function buildHeaderData(headerFields, submittedHeader) {
  const data = {};
  headerFields.forEach(f => {
    // 跳过系统固定字段（order_no / work_order_no 由系统自动管理）
    if (f.field_name === 'order_no' || f.field_name === 'work_order_no') return;
    const val = submittedHeader[f.field_name];
    data[f.field_name] = (val !== undefined && val !== null) ? val : (f.type === 'number' ? 0 : '');
  });
  return data;
}

exports.main = async (event, context) => {
  const { work_order_no, template_id, header_data, steps } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('card_list') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 card_list 权限' };
    }

    if (!work_order_no || !template_id) {
      return { success: false, code: 'INVALID_PARAMS', msg: '工单号、模板为必填' };
    }

    if (!Array.isArray(steps) || steps.filter(s => s && s.trim()).length === 0) {
      return { success: false, code: 'INVALID_PARAMS', msg: '工序列表不能为空' };
    }

    // 自动生成流程卡号 = 工单号 + 两位顺序码（如 A260130011 + 01 = A26013001101）
    const prefix = work_order_no.trim();
    const existingRes = await db.collection('process_cards').where({
      order_no: db.RegExp({ regexp: '^' + escapeRegex(prefix), options: 'i' })
    }).get();
    let maxSeq = 0;
    existingRes.data.forEach(c => {
      const seqStr = (c.order_no || '').replace(prefix, '');
      const seqNum = parseInt(seqStr, 10);
      if (!isNaN(seqNum) && seqNum > maxSeq) maxSeq = seqNum;
    });
    const order_no = prefix + String(maxSeq + 1).padStart(2, '0');

    // 流程卡号唯一性校验（正常不会冲突，作为安全兜底）
    const dupCheck = await db.collection('process_cards').where({ order_no }).get();
    if (dupCheck.data.length > 0) {
      return { success: false, code: 'DUP_ORDER_NO', msg: '流程卡号已存在：' + order_no };
    }

    const tplRes = await db.collection('process_templates').where({ template_id }).get();
    if (tplRes.data.length === 0) {
      return { success: false, code: 'NOT_FOUND', msg: '模板不存在' };
    }
    const template = tplRes.data[0];
    const detailFields = template.detail_fields || [];
    const headerFields = template.header_fields || [];

    const stepNames = steps.filter(s => s && s.trim()).map(s => s.trim());
    const dynamicSteps = stepNames.map((name, i) => buildDynamicStep(name, i + 1, detailFields));
    const builtHeaderData = buildHeaderData(headerFields, header_data || {});

    const addRes = await db.collection('process_cards').add({
      data: {
        order_no,
        work_order_no: prefix,
        template_id,
        header_data: builtHeaderData,
        dynamic_steps: dynamicSteps,
        current_step: stepNames[0],
        current_step_index: 0,
        warehouse_personnel: '',
        warehouse_date: '',
        warehouse_status: '',
        status: '加工中',
        is_locked: false,
        locked_by: '',
        locked_by_user_id: '',
        lock_time: null,
        created_at: db.serverDate(),
        created_by: auth.user.username,
        last_updated: db.serverDate()
      }
    });

    return {
      success: true,
      msg: '流转卡已创建',
      card_id: addRes._id,
      order_no,
      work_order_no: prefix
    };
  } catch (err) {
    return { success: false, msg: '创建失败', error: err };
  }
};
