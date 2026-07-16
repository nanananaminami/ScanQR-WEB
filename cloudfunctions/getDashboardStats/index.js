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

exports.main = async (event, context) => {
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

      const ws = currentStep.step_name;

      if (!wipByWorkstation[ws]) {
        wipByWorkstation[ws] = { workstation: ws, wip_count: 0, card_list: [] };
      }
      wipByWorkstation[ws].wip_count += 1;
      wipByWorkstation[ws].card_list.push(card.order_no);

      if (stepIndex > 0 && currentStep.prod_started_at) {
        const prevStep = steps[stepIndex - 1];
        if (prevStep && prevStep.prod_completed_at) {
          const prevCompleted = new Date(prevStep.prod_completed_at);
          const startedAt = new Date(currentStep.prod_started_at);
          const waitMinutes = Math.floor((startedAt.getTime() - prevCompleted.getTime()) / 60000);
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
