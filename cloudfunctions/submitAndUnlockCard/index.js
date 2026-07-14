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

// 比较新旧 dynamic_steps，收集变更明细用于日志留痕
function collectChanges(oldSteps, newSteps, detailFields) {
  const changes = [];
  if (!Array.isArray(oldSteps) || !Array.isArray(newSteps)) return changes;
  const fieldNames = (detailFields || []).map(f => f.field_name);

  for (let i = 0; i < Math.min(oldSteps.length, newSteps.length); i++) {
    const oldStep = oldSteps[i];
    const newStep = newSteps[i];
    const rowChanges = [];

    // 工序级字段：device_no / fixture_no
    ['device_no', 'fixture_no'].forEach(key => {
      const oldVal = oldStep[key] || '';
      const newVal = newStep[key] || '';
      if (String(oldVal) !== String(newVal)) {
        rowChanges.push({ key, old: String(oldVal), new: String(newVal) });
      }
    });

    // 部门级字段：遍历 depts 数组
    const oldDepts = oldStep.depts || [];
    const newDepts = newStep.depts || [];
    for (let d = 0; d < Math.min(oldDepts.length, newDepts.length); d++) {
      const oldDept = oldDepts[d];
      const newDept = newDepts[d];
      const deptName = oldDept.dept_name || newDept.dept_name || ('部门' + (d + 1));
      fieldNames.forEach(fn => {
        const oldVal = (oldDept[fn] !== undefined && oldDept[fn] !== null) ? oldDept[fn] : '';
        const newVal = (newDept[fn] !== undefined && newDept[fn] !== null) ? newDept[fn] : '';
        if (String(oldVal) !== String(newVal)) {
          rowChanges.push({ key: deptName + '.' + fn, old: String(oldVal), new: String(newVal) });
        }
      });
    }

    if (rowChanges.length > 0) {
      changes.push({
        step_name: oldStep.step_name || newStep.step_name,
        sort: oldStep.sort || newStep.sort,
        fields: rowChanges
      });
    }
  }
  return changes;
}

exports.main = async (event, context) => {
  const { order_no, card_id, dynamic_steps, header_data, operator_name, warehouse_personnel, warehouse_date, cancelled } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('card_submit') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 card_submit 权限' };
    }

    const operator = operator_name || auth.user.real_name || auth.user.username || '未知操作员';

    const cardRes = await db.collection('process_cards').doc(card_id).get();
    if (!cardRes.data) {
      return { success: false, code: 'NOT_FOUND', msg: '流转卡不存在' };
    }
    const card = cardRes.data;

    let detailFields = [];
    if (card.template_id) {
      try {
        const tplRes = await db.collection('process_templates').where({ template_id: card.template_id }).get();
        if (tplRes.data.length > 0) {
          detailFields = tplRes.data[0].detail_fields || [];
        }
      } catch (e) { /* ignore */ }
    }

    const oldSteps = card.dynamic_steps || card.steps || [];

    const updateData = {
      is_locked: false,
      locked_by: '',
      locked_by_user_id: '',
      lock_time: null,
      last_updated: db.serverDate()
    };

    if (!cancelled) {
      if (Array.isArray(dynamic_steps)) updateData.dynamic_steps = dynamic_steps;
      if (header_data) updateData.header_data = header_data;
      if (warehouse_personnel !== undefined) updateData.warehouse_personnel = warehouse_personnel;
      if (warehouse_date !== undefined) updateData.warehouse_date = warehouse_date;
    }

    await db.collection('process_cards').doc(card_id).update({ data: updateData });

    const changes = cancelled ? [] : collectChanges(oldSteps, dynamic_steps || [], detailFields);
    const logData = {
      order_no: order_no || card.order_no,
      card_no: card.order_no || '',
      card_id: card_id,
      operator_name: operator,
      operator_user_id: auth.user._id,
      operator_username: auth.user.username,
      step_name: '',
      form_data: cancelled ? {} : {
        steps_changed: changes,
        steps_count: (dynamic_steps || []).length,
        warehouse_personnel: warehouse_personnel || '',
        warehouse_date: warehouse_date || ''
      },
      cancelled: !!cancelled,
      submit_time: db.serverDate()
    };

    if (changes.length > 0) {
      logData.step_name = changes.map(c => c.step_name).join('、');
    }

    await db.collection('process_logs').add({ data: logData });

    return { success: true, unlocked: true, log_written: true, changes_count: changes.length };
  } catch (err) {
    return { success: false, msg: '提交失败', error: err };
  }
};
