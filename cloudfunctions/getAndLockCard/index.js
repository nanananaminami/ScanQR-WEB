const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 锁超时：30 分钟后可被他人抢占，避免死锁
const LOCK_TIMEOUT_MS = 30 * 60 * 1000;

exports.main = async (event, context) => {
  const { card_no, user_name } = event;
  const wxContext = cloud.getWXContext();

  if (!card_no) {
    return { success: false, code: 'NO_CARD_NO', msg: '缺少流程卡号' };
  }

  const operator = user_name || wxContext.OPENID || '未知操作员';
  const now = new Date();

  try {
    // 第一步：原子上锁 —— 仅当 is_locked=false 时命中（数据库引擎保证原子性）
    let lockRes = await db.collection('process_cards').where({
      card_no: card_no,
      is_locked: false
    }).update({
      data: {
        is_locked: true,
        locked_by: operator,
        lock_time: now
      }
    });

    // 第二步：若没锁到，尝试抢占超时锁（防止死锁）
    if (lockRes.stats.updated === 0) {
      lockRes = await db.collection('process_cards').where({
        card_no: card_no,
        is_locked: true,
        lock_time: _.lt(new Date(now.getTime() - LOCK_TIMEOUT_MS))
      }).update({
        data: {
          is_locked: true,
          locked_by: operator,
          lock_time: now
        }
      });
    }

    if (lockRes.stats.updated === 0) {
      // 仍未锁到：单据不存在 或 被他人正常锁定
      const existRes = await db.collection('process_cards').where({ card_no }).get();
      if (existRes.data.length === 0) {
        return { success: false, code: 'NOT_FOUND', msg: '未找到流程卡：' + card_no };
      }
      const holder = existRes.data[0].locked_by || '他人';
      return { success: false, code: 'LOCKED', msg: '该流程卡正由「' + holder + '」编辑中，请稍后再试' };
    }

    // 上锁成功，拉取完整流程卡数据
    const cardRes = await db.collection('process_cards').where({ card_no }).get();
    const targetCard = cardRes.data[0];

    // 拉取动态表单模板
    let templateData = null;
    if (targetCard.template_id) {
      try {
        const tplRes = await db.collection('process_templates').doc(targetCard.template_id).get();
        templateData = tplRes.data;
      } catch (e) {
        templateData = null;
      }
    }

    return {
      success: true,
      code: 'OK',
      cardData: targetCard,
      templateData: templateData,
      operator: operator
    };
  } catch (err) {
    return { success: false, code: 'ERROR', msg: '系统异常', error: err };
  }
};
