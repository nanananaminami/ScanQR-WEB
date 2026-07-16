const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const LOCK_TIMEOUT_MS = 30 * 60 * 1000;

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

function calcSlaMinutes(prevCompletedAt) {
  if (!prevCompletedAt) return null;
  const prev = new Date(prevCompletedAt);
  const now = new Date();
  return Math.floor((now.getTime() - prev.getTime()) / 60000);
}

exports.main = async (event, context) => {
  const { order_no, user_name } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('card_submit') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 card_submit 权限' };
    }

    if (!order_no) {
      return { success: false, code: 'NO_ORDER_NO', msg: '缺少工单号' };
    }

    const operator = user_name || auth.user.real_name || auth.user.username || '未知操作员';
    const operatorUserId = auth.user._id;
    const rawWs = auth.user.workstation;
    const operatorWorkstations = Array.isArray(rawWs)
      ? rawWs.filter(s => s)
      : (rawWs && typeof rawWs === 'string' ? [rawWs.trim()] : []);
    const now = new Date();

    let lockRes = await db.collection('process_cards').where({
      order_no: order_no,
      is_locked: false
    }).update({
      data: {
        is_locked: true,
        locked_by: operator,
        locked_by_user_id: operatorUserId,
        lock_time: now
      }
    });

    if (lockRes.stats.updated === 0) {
      lockRes = await db.collection('process_cards').where({
        order_no: order_no,
        is_locked: true,
        lock_time: _.lt(new Date(now.getTime() - LOCK_TIMEOUT_MS))
      }).update({
        data: {
          is_locked: true,
          locked_by: operator,
          locked_by_user_id: operatorUserId,
          lock_time: now
        }
      });
    }

    if (lockRes.stats.updated === 0) {
      const existRes = await db.collection('process_cards').where({ order_no }).get();
      if (existRes.data.length === 0) {
        return { success: false, code: 'NOT_FOUND', msg: '未找到流转卡：' + order_no };
      }
      const holder = existRes.data[0].locked_by || '他人';
      return { success: false, code: 'LOCKED', msg: '该流转卡正由「' + holder + '」编辑中，请稍后再试' };
    }

    const cardRes = await db.collection('process_cards').where({ order_no }).get();
    const cardData = cardRes.data[0];

    const stepsField = cardData.dynamic_steps ? 'dynamic_steps' : 'steps';

    let steps = cardData[stepsField] || [];
    if (steps.length > 0 && steps[0].depts && steps[0].depts.length) {
      // dynamic_steps format: already in new format
    } else {
      // Legacy flat steps format — normalize to new format with a depts wrapper
      steps = steps.map(s => ({
        step_name: s.step_name,
        sort: s.sort,
        device_no: s.device_no || '',
        fixture_no: s.fixture_no || '',
        prod_started_at: s.prod_started_at || null,
        prod_completed_at: s.prod_completed_at || null,
        prod_completed_by: s.prod_completed_by || null,
        qc_completed_at: s.qc_completed_at || null,
        qc_completed_by: s.qc_completed_by || null,
        depts: s.depts || [
          { dept_name: '生产' },
          { dept_name: '品质' }
        ]
      }));
    }
    cardData.dynamic_steps = steps;

    let match = null;

    if (operatorWorkstations.length > 0) {
      const matchedList = [];
      const nowStr = now.toISOString();

      for (const ws of operatorWorkstations) {
        const idx = steps.findIndex(s => s.step_name === ws);
        if (idx === -1) continue;

        const currentStep = steps[idx];

        const gated = idx > 0 && !steps[idx - 1].prod_completed_at;

        if (!currentStep.prod_started_at) {
          await db.collection('process_cards').doc(cardData._id).update({
            data: {
              [stepsField + '.' + idx + '.prod_started_at']: nowStr,
              last_updated: db.serverDate()
            }
          }).catch(() => {});
          currentStep.prod_started_at = nowStr;
        }

        let slaMinutes = null;
        let slaText = null;
        if (idx > 0 && steps[idx - 1].prod_completed_at) {
          slaMinutes = calcSlaMinutes(steps[idx - 1].prod_completed_at);
          slaText = slaMinutes !== null
            ? (slaMinutes >= 1440 ? Math.floor(slaMinutes / 1440) + '天' + (slaMinutes % 1440 >= 60 ? Math.floor((slaMinutes % 1440) / 60) + '小时' : '') : (slaMinutes >= 60 ? Math.floor(slaMinutes / 60) + '小时' + (slaMinutes % 60) + '分' : slaMinutes + '分钟'))
            : null;
        }

        matchedList.push({
          step_index: idx,
          step_name: ws,
          step: currentStep,
          sla_minutes: slaMinutes,
          sla_text: slaText,
          gated: gated
        });
      }

      if (matchedList.length === 0) {
        return {
          success: false, code: 'NO_MATCH_STEP',
          msg: '该工单没有' + operatorWorkstations.join('、') + '工段，请联系管理员'
        };
      }

      const firstIdx = matchedList[0].step_index;
      cardData.current_step = matchedList.map(m => m.step_name).join('、');
      cardData.current_step_index = firstIdx;

      const missingQC = steps.slice(0, firstIdx).filter(s => !s.qc_completed_at);
      const allQCComplete = steps.every(s => s.qc_completed_at);

      match = {
        matched_steps: matchedList,
        missing_qc_steps: missingQC.map(s => s.step_name),
        quality_gate_ok: missingQC.length === 0,
        all_qc_complete: allQCComplete,
        all_steps_summary: steps.map(s => ({
          step_name: s.step_name,
          sort: s.sort,
          prod_started_at: s.prod_started_at || null,
          prod_completed_at: s.prod_completed_at || null,
          prod_completed_by: s.prod_completed_by || null,
          qc_completed_at: s.qc_completed_at || null,
          qc_completed_by: s.qc_completed_by || null
        }))
      };
    }

    let templateData = null;
    if (cardData.template_id) {
      try {
        const tplRes = await db.collection('process_templates').where({ template_id: cardData.template_id }).get();
        if (tplRes.data.length > 0) {
          templateData = tplRes.data[0];

          const allSelectFields = [
            ...(templateData.header_fields || []).filter(f => f.type === 'select' && f.dict_id),
            ...(templateData.detail_fields || []).filter(f => f.type === 'select' && f.dict_id)
          ];
          const dictIds = [...new Set(allSelectFields.map(f => f.dict_id))];
          if (dictIds.length > 0) {
            const dictRes = await db.collection('sys_dicts').where({ dict_id: _.in(dictIds) }).get();
            const dictMap = {};
            dictRes.data.forEach(d => { dictMap[d.dict_id] = d.options || []; });

            const resolveSelects = (fields) => fields.map(f => {
              if (f.type === 'select' && f.dict_id && dictMap[f.dict_id]) {
                return Object.assign({}, f, { options: dictMap[f.dict_id] });
              }
              return f;
            });

            templateData.header_fields = resolveSelects(templateData.header_fields || []);
            templateData.detail_fields = resolveSelects(templateData.detail_fields || []);
          }
        }
      } catch (e) {
        templateData = null;
      }
    }

    return {
      success: true,
      code: 'OK',
      cardData: cardData,
      templateData: templateData,
      operator: operator,
      match: match
    };
  } catch (err) {
    return { success: false, code: 'ERROR', msg: '系统异常', error: err };
  }
};
