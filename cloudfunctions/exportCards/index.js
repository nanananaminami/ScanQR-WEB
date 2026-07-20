const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

const CSV_HEADERS = [
  '工单号', '卡号', '模板', '状态', '当前工序', '是否锁定', '锁定人', '锁定时间',
  '仓库人员', '仓库日期', '仓库状态', '阻断原因',
  '工序摘要', '完工工序数', '总工序数',
  '创建时间', '创建人', '最后更新'
];

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? '"' + s + '"' : s;
}

function stepsSummary(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return '';
  return steps.map(s => s.step_name || '').filter(Boolean).join('→');
}

function countCompleted(steps) {
  if (!Array.isArray(steps)) return 0;
  return steps.filter(s => s.prod_completed_at || s.qc_completed_at).length;
}

function normalizeSteps(card) {
  if (Array.isArray(card.dynamic_steps) && card.dynamic_steps.length > 0) {
    return card.dynamic_steps;
  }
  if (Array.isArray(card.steps) && card.steps.length > 0) {
    return card.steps;
  }
  return [];
}

function formatDate(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

async function fetchTemplateName(templateId) {
  if (!templateId) return '';
  try {
    const res = await db.collection('process_templates').where({ template_id: templateId }).get();
    return res.data.length > 0 ? (res.data[0].template_name || '') : '';
  } catch (_) { return ''; }
}

exports.main = async (event) => {
  event = common.unwrapHttpEvent(event);
  const { status, template_id, date_from, date_to, keyword } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('card_list') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限：缺少 card_list 权限' };
    }

    const where = {};
    if (status && ['加工中', '已完工', '已作废'].includes(status)) where.status = status;
    if (template_id) where.template_id = template_id;
    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) where.created_at = _.gte(new Date(date_from));
      if (date_to) where.created_at = Object.assign(where.created_at, _.lte(new Date(date_to + 'T23:59:59')));
    }
    if (keyword) {
      const safe = common.escapeRegex(keyword);
      where.order_no = db.RegExp({ regexp: safe, options: 'i' });
    }

    let allCards = [];
    let offset = 0;
    const limit = 200;

    while (true) {
      const res = await db.collection('process_cards')
        .where(where)
        .orderBy('created_at', 'desc')
        .skip(offset)
        .limit(limit)
        .get();
      if (res.data.length === 0) break;
      allCards = allCards.concat(res.data);
      if (res.data.length < limit) break;
      offset += limit;
    }

    const templateCache = {};
    for (const card of allCards) {
      if (card.template_id && !templateCache[card.template_id]) {
        templateCache[card.template_id] = await fetchTemplateName(card.template_id);
      }
    }

    const rows = allCards.map(card => {
      const steps = normalizeSteps(card);
      const tplName = templateCache[card.template_id] || card.template_id || '';
      return [
        escapeCsv(card.work_order_no || ''),
        escapeCsv(card.order_no || ''),
        escapeCsv(tplName),
        escapeCsv(card.status || ''),
        escapeCsv(card.current_step || ''),
        escapeCsv(card.is_locked ? '是' : '否'),
        escapeCsv(card.locked_by || ''),
        escapeCsv(formatDate(card.lock_time)),
        escapeCsv(card.warehouse_personnel || ''),
        escapeCsv(card.warehouse_date || ''),
        escapeCsv(card.warehouse_status || ''),
        escapeCsv(card.warehouse_block_reason || ''),
        escapeCsv(stepsSummary(steps)),
        escapeCsv(String(countCompleted(steps))),
        escapeCsv(String(steps.length)),
        escapeCsv(formatDate(card.created_at)),
        escapeCsv(card.created_by || ''),
        escapeCsv(formatDate(card.last_updated))
      ];
    });

    const bom = '\uFEFF';
    const csv = bom + [CSV_HEADERS.join(','), ...rows.map(r => r.join(','))].join('\n');

    const fileName = 'cards_export_' + Date.now() + '.csv';
    const cloudPath = 'exports/' + fileName;
    const uploadResult = await cloud.uploadFile({
      cloudPath,
      fileContent: Buffer.from(csv, 'utf-8')
    });

    const tempFileResult = await cloud.getTempFileURL({
      fileList: [uploadResult.fileID]
    });

    const downloadUrl = (tempFileResult.fileList[0] || {}).tempFileURL || '';

    return {
      success: true,
      total: allCards.length,
      fileID: uploadResult.fileID,
      downloadUrl,
      msg: '导出 ' + allCards.length + ' 条记录'
    };
  } catch (err) {
    return { success: false, msg: '导出失败', error: err };
  }
};
