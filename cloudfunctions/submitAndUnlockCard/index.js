const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

function collectChanges(oldSteps, newSteps, detailFields) {
  const changes = [];
  if (!Array.isArray(oldSteps) || !Array.isArray(newSteps)) return changes;
  const fieldNames = (detailFields || []).map(f => f.field_name);

  for (let i = 0; i < Math.min(oldSteps.length, newSteps.length); i++) {
    const oldStep = oldSteps[i];
    const newStep = newSteps[i];
    const rowChanges = [];

    ['device_no', 'fixture_no'].forEach(key => {
      const oldVal = oldStep[key] || '';
      const newVal = newStep[key] || '';
      if (String(oldVal) !== String(newVal)) {
        rowChanges.push({ key, old: String(oldVal), new: String(newVal) });
      }
    });

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
  event = common.unwrapHttpEvent(event);
  const { order_no, card_id, dynamic_steps, header_data, operator_name,
          matched_steps, step_index, dept_type, warehouse_personnel, warehouse_date, cancelled } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('card_submit') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 card_submit 权限' };
    }

    const operator = operator_name || auth.user.real_name || auth.user.username || '未知操作员';
    const now = new Date();
    const nowStr = now.toISOString();

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

    const stepsField = card.dynamic_steps ? 'dynamic_steps' : 'steps';
    const oldSteps = card[stepsField] || [];

    const updateData = {
      is_locked: false,
      locked_by: '',
      locked_by_user_id: '',
      lock_time: null,
      last_updated: db.serverDate()
    };

    let gateBlocked = false;
    let gateMsg = '';
    let qualityGateViolations = [];
    let slaRecord = null;

    if (!cancelled) {
      let stepsToSave = dynamic_steps;

      const steps = Array.isArray(dynamic_steps) ? dynamic_steps : oldSteps;
      const completions = [];

      if (matched_steps && matched_steps.length > 0) {
        for (const ms of matched_steps) {
          const si = ms.step_index;
          const dt = ms.dept_type;
          const currentStep = steps[si];
          if (!currentStep) continue;

          const isQcOnly = currentStep.step_type === 'qc';

          if (dt === '生产') {
            if (isQcOnly) continue;
            if (si > 0 && !steps[si - 1].prod_completed_at) {
              gateBlocked = true;
              gateMsg = '上一道工序「' + steps[si - 1].step_name + '」生产未完成';
              break;
            }
            currentStep.prod_completed_at = nowStr;
            currentStep.prod_completed_by = operator;
          } else if (dt === '品质') {
            currentStep.qc_completed_at = nowStr;
            currentStep.qc_completed_by = operator;
          }
          completions.push({ step_index: si, dept_type: dt });
        }

        if (!gateBlocked) {
          const nextIndex = steps.findIndex((s, i) => i >= 0 && !s.prod_completed_at && !(s.step_type === 'qc'));
          if (nextIndex !== -1) {
            updateData.current_step = steps[nextIndex].step_name;
            updateData.current_step_index = nextIndex;
          }
        }
      } else if (step_index !== undefined && dept_type) {
        const currentStep = steps[step_index];
        if (!currentStep) {
          return { success: false, code: 'INVALID_STEP', msg: '工序序号无效' };
        }

        if (dept_type === '生产') {
          if (step_index > 0) {
            const prevStep = steps[step_index - 1];
            if (prevStep.prod_completed_at) {
              slaRecord = {
                step_name: currentStep.step_name,
                prev_step_name: prevStep.step_name,
                prev_completed_at: prevStep.prod_completed_at,
                started_at: currentStep.prod_started_at || nowStr,
                wait_minutes: Math.floor((now.getTime() - new Date(prevStep.prod_completed_at).getTime()) / 60000)
              };
            } else {
              gateBlocked = true;
              gateMsg = '上一道工序「' + prevStep.step_name + '」生产未完成';
            }
          }

          if (!gateBlocked) {
            currentStep.prod_completed_at = nowStr;
            currentStep.prod_completed_by = operator;

            const nextIndex = steps.findIndex((s, i) => i > step_index && !s.prod_completed_at);
            if (nextIndex !== -1) {
              updateData.current_step = steps[nextIndex].step_name;
              updateData.current_step_index = nextIndex;
            }
          }
        } else if (dept_type === '品质') {
          currentStep.qc_completed_at = nowStr;
          currentStep.qc_completed_by = operator;
        }
      }

      stepsToSave = steps;

      if (Array.isArray(stepsToSave)) updateData.dynamic_steps = stepsToSave;
      if (header_data) updateData.header_data = header_data;

      if ((warehouse_personnel || warehouse_date) && !gateBlocked) {
        const steps = Array.isArray(dynamic_steps) ? dynamic_steps : oldSteps;
        const missingQC = steps.filter(s => s.step_name && !s.qc_completed_at);
        const missingProd = steps.filter(s => s.step_name && !s.prod_completed_at && !(s.step_type === 'qc'));

        if (missingQC.length > 0 || missingProd.length > 0) {
          const reasons = [];
          if (missingQC.length > 0) {
            reasons.push('以下工序品质未完成：' + missingQC.map(s => s.step_name).join('、'));
          }
          if (missingProd.length > 0) {
            reasons.push('以下工序生产未完成：' + missingProd.map(s => s.step_name).join('、'));
          }
          qualityGateViolations = reasons;
          updateData.warehouse_status = 'blocked';
          updateData.warehouse_block_reason = reasons.join('；');
        } else {
          updateData.warehouse_status = 'completed';
          updateData.warehouse_block_reason = '';
        }
      }

      if (warehouse_personnel !== undefined) updateData.warehouse_personnel = warehouse_personnel;
      if (warehouse_date !== undefined) updateData.warehouse_date = warehouse_date;
    }

    if (gateBlocked) {
      await db.collection('process_cards').doc(card_id).update({
        data: {
          is_locked: false,
          locked_by: '',
          locked_by_user_id: '',
          lock_time: null,
          last_updated: db.serverDate()
        }
      });
      return { success: false, code: 'GATE_BLOCKED', msg: gateMsg };
    }

    if (qualityGateViolations.length > 0) {
      updateData.is_locked = false;
      updateData.locked_by = '';
      updateData.locked_by_user_id = '';
      updateData.lock_time = null;
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
      dept_type: dept_type || '',
      form_data: cancelled ? {} : {
        steps_changed: changes,
        steps_count: (dynamic_steps || []).length,
        warehouse_personnel: warehouse_personnel || '',
        warehouse_date: warehouse_date || '',
        sla_record: slaRecord || null,
        quality_gate_violations: qualityGateViolations
      },
      cancelled: !!cancelled,
      submit_time: db.serverDate()
    };

    if (changes.length > 0) {
      logData.step_name = changes.map(c => c.step_name).join('、');
    } else if (step_index !== undefined && dynamic_steps && dynamic_steps[step_index]) {
      logData.step_name = dynamic_steps[step_index].step_name || '';
    }

    await db.collection('process_logs').add({ data: logData });

    return {
      success: true,
      unlocked: true,
      gate_blocked: gateBlocked,
      quality_gate_blocked: qualityGateViolations.length > 0,
      quality_gate_violations: qualityGateViolations,
      sla_record: slaRecord,
      log_written: true,
      changes_count: changes.length
    };
  } catch (err) {
    return { success: false, msg: '提交失败', error: err };
  }
};
