const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const common = require('./common');
const authenticate = common.makeAuth(db, _);

const CSV_HEADERS = [
  '工单号', '卡号', '操作人', '操作人账号',
  '工序名称', '部门类型', '操作类型',
  '工序变更数', '变更详情',
  '仓库人员', '仓库日期', 'SLA记录',
  '异常阻断', '提交时间'
];

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? '"' + s + '"' : s;
}

function formatDate(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function getOpType(log) {
  if (log.is_force_unlock) return '强制解锁';
  if (log.cancelled) return '取消/解锁';
  return '正常报工';
}

function changesSummary(formData) {
  if (!formData || !Array.isArray(formData.steps_changed)) return '';
  return formData.steps_changed.map(sc => {
    const fields = (sc.fields || []).map(f => f.key + ':' + f.old + '→' + f.new).join('; ');
    return sc.step_name + '(' + fields + ')';
  }).join(' | ');
}

function slaSummary(slaRecord) {
  if (!slaRecord) return '';
  return slaRecord.prev_step_name + '→' + slaRecord.step_name
    + ' 等待' + (common.formatWaitTime ? common.formatWaitTime(slaRecord.wait_minutes) : slaRecord.wait_minutes + '分');
}

exports.main = async (event) => {
  event = common.unwrapHttpEvent(event);
  const { keyword, status, date_from, date_to } = event;
  try {
    const auth = await authenticate(event);
    if (!auth.ok) return { success: false, code: auth.code, msg: auth.msg };
    if (auth.permissions.indexOf('log_view') === -1 && auth.permissions.indexOf('log_export') === -1) {
      return { success: false, code: 'FORBIDDEN', msg: '无权限' };
    }

    const where = {};
    if (keyword) {
      const safe = common.escapeRegex(keyword);
      where.card_no = db.RegExp({ regexp: safe, options: 'i' });
    }
    if (status === 'normal') {
      where.cancelled = false;
    } else if (status === 'cancelled') {
      where.cancelled = true;
      where.is_force_unlock = _.neq(true);
    } else if (status === 'force_unlock') {
      where.is_force_unlock = true;
    }
    if (date_from || date_to) {
      where.submit_time = {};
      if (date_from) where.submit_time = _.gte(new Date(date_from));
      if (date_to) where.submit_time = Object.assign(where.submit_time, _.lte(new Date(date_to + 'T23:59:59')));
    }

    let allLogs = [];
    let offset = 0;
    const limit = 200;

    while (true) {
      const res = await db.collection('process_logs')
        .where(where)
        .orderBy('submit_time', 'desc')
        .skip(offset)
        .limit(limit)
        .get();
      if (res.data.length === 0) break;
      allLogs = allLogs.concat(res.data);
      if (res.data.length < limit) break;
      offset += limit;
    }

    const rows = allLogs.map(log => {
      const fd = log.form_data || {};
      return [
        escapeCsv(log.order_no || ''),
        escapeCsv(log.card_no || ''),
        escapeCsv(log.operator_name || ''),
        escapeCsv(log.operator_username || ''),
        escapeCsv(log.step_name || ''),
        escapeCsv(log.dept_type || ''),
        escapeCsv(getOpType(log)),
        escapeCsv(fd.steps_count !== undefined ? String(fd.steps_count) : ''),
        escapeCsv(changesSummary(fd)),
        escapeCsv(fd.warehouse_personnel || ''),
        escapeCsv(fd.warehouse_date || ''),
        escapeCsv(slaSummary(fd.sla_record)),
        escapeCsv((fd.quality_gate_violations || []).join('; ')),
        escapeCsv(formatDate(log.submit_time))
      ];
    });

    const bom = '\uFEFF';
    const csv = bom + [CSV_HEADERS.join(','), ...rows.map(r => r.join(','))].join('\n');

    const fileName = 'logs_export_' + Date.now() + '.csv';
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
      total: allLogs.length,
      fileID: uploadResult.fileID,
      downloadUrl,
      msg: '导出 ' + allLogs.length + ' 条记录'
    };
  } catch (err) {
    return { success: false, msg: '导出失败', error: err };
  }
};
