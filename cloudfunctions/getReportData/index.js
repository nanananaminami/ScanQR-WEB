const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

function toDateStr(d) {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

function dateRange(from, to) {
  const days = [];
  const cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    days.push(toDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

exports.main = async (event) => {
  event = common.unwrapHttpEvent(event);
  const { date_from, date_to } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (!auth.permissions.some(p => ['dashboard_view', 'card_list', 'log_view'].includes(p))) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限' };
    }

    const today = new Date();
    const from = date_from ? new Date(date_from) : new Date(today.getTime() - 30 * 24 * 3600 * 1000);
    const to = date_to ? new Date(date_to + 'T23:59:59') : today;

    const days = dateRange(from, to);

    const [cardsCreatedRes, cardsCompletedRes, cardsCancelledRes, logsRes] = await Promise.all([
      db.collection('process_cards').where({
        created_at: _.gte(from).and(_.lte(to))
      }).get(),
      db.collection('process_cards').where({
        status: '已完工',
        last_updated: _.gte(from).and(_.lte(to))
      }).get(),
      db.collection('process_cards').where({
        status: '已作废',
        last_updated: _.gte(from).and(_.lte(to))
      }).get(),
      db.collection('process_logs').where({
        submit_time: _.gte(from).and(_.lte(to))
      }).get()
    ]);

    const daily = {};
    days.forEach(d => { daily[d] = { date: d, created: 0, completed: 0, cancelled: 0, scans: 0, forceUnlocks: 0 }; });

    cardsCreatedRes.data.forEach(c => {
      const d = toDateStr(new Date(c.created_at));
      if (daily[d]) daily[d].created++;
    });
    cardsCompletedRes.data.forEach(c => {
      const d = toDateStr(new Date(c.last_updated));
      if (daily[d]) daily[d].completed++;
    });
    cardsCancelledRes.data.forEach(c => {
      const d = toDateStr(new Date(c.last_updated));
      if (daily[d]) daily[d].cancelled++;
    });
    logsRes.data.forEach(l => {
      const d = toDateStr(new Date(l.submit_time));
      if (!daily[d]) return;
      if (l.is_force_unlock) daily[d].forceUnlocks++;
      else if (!l.cancelled) daily[d].scans++;
    });

    const trend = Object.values(daily);

    const wipCards = await db.collection('process_cards')
      .where({ status: '加工中' })
      .field({ order_no: true, current_step: true, current_step_index: true, dynamic_steps: true, steps: true })
      .get();

    const wipByStep = {};
    wipCards.data.forEach(card => {
      const steps = card.dynamic_steps || card.steps || [];
      if (steps.length === 0) return;
      const si = card.current_step_index !== undefined ? card.current_step_index : 0;
      const step = steps[si];
      if (!step || step.step_type === 'qc') return;
      const sn = step.step_name || '未知';
      if (!wipByStep[sn]) wipByStep[sn] = { step_name: sn, count: 0 };
      wipByStep[sn].count++;
    });

    const stepBreakdown = Object.values(wipByStep).sort((a, b) => b.count - a.count);

    const summary = {
      totalCreated: cardsCreatedRes.data.length,
      totalCompleted: cardsCompletedRes.data.length,
      totalCancelled: cardsCancelledRes.data.length,
      totalScans: logsRes.data.filter(l => !l.is_force_unlock && !l.cancelled).length,
      totalForceUnlocks: logsRes.data.filter(l => l.is_force_unlock).length,
      wipCount: wipCards.data.length,
      days: days.length
    };

    return {
      success: true,
      dateRange: { from: toDateStr(from), to: toDateStr(to) },
      summary,
      trend,
      stepBreakdown
    };
  } catch (err) {
    return { success: false, msg: '查询失败', error: err };
  }
};
