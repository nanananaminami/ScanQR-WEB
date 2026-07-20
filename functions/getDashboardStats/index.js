const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

exports.main = async (event, context) => {
  event = common.unwrapHttpEvent(event);
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('dashboard_view') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 dashboard_view 权限' };
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [todayLogs, activeCards, lockedCards, todayExceptions, totalLogs, activeCardsData] = await Promise.all([
      db.collection('process_logs').where({ submit_time: _.gte(todayStart) }).count(),
      db.collection('process_cards').where({ status: '加工中' }).count(),
      db.collection('process_cards').where({ is_locked: true }).count(),
      db.collection('process_logs').where({ submit_time: _.gte(todayStart), cancelled: true }).count(),
      db.collection('process_logs').count(),
      db.collection('process_cards').where({ status: '加工中' }).field({
        order_no: true, current_step: true, current_step_index: true,
        dynamic_steps: true, steps: true
      }).get()
    ]);

    const wipByWorkstation = {};
    const slaBottlenecks = [];
    const now = new Date();

    (activeCardsData.data || []).forEach(card => {
      const steps = card.dynamic_steps || card.steps || [];
      if (steps.length === 0) return;

      const stepIndex = card.current_step_index !== undefined ? card.current_step_index : 0;
      const currentStep = steps[stepIndex];
      if (!currentStep || !currentStep.step_name) return;

      if (currentStep.step_type === 'qc') return;

      const ws = currentStep.step_name;

      if (!wipByWorkstation[ws]) {
        wipByWorkstation[ws] = { workstation: ws, wip_count: 0, card_list: [] };
      }
      wipByWorkstation[ws].wip_count += 1;
      wipByWorkstation[ws].card_list.push(card.order_no);

      if (stepIndex > 0) {
        const prevStep = steps[stepIndex - 1];
        if (prevStep && prevStep.prod_completed_at) {
          const prevCompleted = new Date(prevStep.prod_completed_at);
          const endTime = currentStep.prod_completed_at
            ? new Date(currentStep.prod_completed_at)
            : now;
          const waitMinutes = Math.floor((endTime.getTime() - prevCompleted.getTime()) / 60000);
          const _debugVer = 2; // v2: 按 completed_at 或 now 计算
          if (waitMinutes > 0) {
            slaBottlenecks.push({
              order_no: card.order_no,
              from_step: prevStep.step_name,
              to_step: currentStep.step_name,
              wait_minutes: waitMinutes
            });
          }
        }
      }
    });

    slaBottlenecks.sort((a, b) => b.wait_minutes - a.wait_minutes);
    const topSlaBottlenecks = slaBottlenecks.slice(0, 10).map(b => ({
      ...b,
      wait_text: b.wait_minutes >= 1440
        ? Math.floor(b.wait_minutes / 1440) + '天' + (b.wait_minutes % 1440 >= 60 ? Math.floor((b.wait_minutes % 1440) / 60) + '小时' : '')
        : (b.wait_minutes >= 60
          ? Math.floor(b.wait_minutes / 60) + '小时' + (b.wait_minutes % 60) + '分'
          : b.wait_minutes + '分钟')
    }));

    return {
      success: true,
      _sla_v: 2,
      stats: {
        todayScans: todayLogs.total,
        activeCards: activeCards.total,
        lockedCards: lockedCards.total,
        todayExceptions: todayExceptions.total,
        totalLogs: totalLogs.total,
        wipByWorkstation: Object.values(wipByWorkstation),
        slaBottlenecks: topSlaBottlenecks
      }
    };
  } catch (err) {
    return { success: false, msg: '统计失败', error: err };
  }
};
