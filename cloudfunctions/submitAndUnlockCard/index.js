const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { card_no, card_id, form_data, step_name, user_name, cancelled } = event;
  const wxContext = cloud.getWXContext();
  const operator = user_name || wxContext.OPENID || '未知操作员';

  try {
    // 1. 写入操作日志（无论提交还是放弃，均留痕）
    await db.collection('process_logs').add({
      data: {
        card_no: card_no,
        card_id: card_id || '',
        operator_name: operator,
        operator_openid: wxContext.OPENID || '',
        step_name: step_name || '',
        form_data: form_data || {},
        cancelled: !!cancelled,
        submit_time: db.serverDate()
      }
    });

    // 2. 解锁流程卡 + 可选状态推进
    const updateData = {
      is_locked: false,
      locked_by: '',
      lock_time: null,
      last_updated: db.serverDate()
    };

    // 非放弃场景下，根据表单数据推进状态
    if (!cancelled && form_data) {
      if (form_data.status) {
        updateData.status = form_data.status;
      }
    }

    const updateRes = await db.collection('process_cards').doc(card_id).update({
      data: updateData
    });

    return {
      success: true,
      updated: updateRes.stats.updated,
      log_written: true
    };
  } catch (err) {
    return { success: false, msg: '提交失败', error: err };
  }
};
