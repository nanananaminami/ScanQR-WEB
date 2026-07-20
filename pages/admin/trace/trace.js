const auth = require('../../../utils/auth');
const { formatFullDateTime } = require('../../../utils/time');

Page({
  data: {
    loading: true,
    cardNo: '',
    card: null,
    logs: [],
    stepCount: 0,
    projectName: '',
    headerEntries: []
  },

  onLoad(options) {
    const orderNo = options.order_no ? decodeURIComponent(options.order_no) : '';
    const cardNo = options.card_no ? decodeURIComponent(options.card_no) : '';
    const queryId = orderNo || cardNo;
    this.setData({ cardNo: queryId });
    if (!auth.requireLogin()) return;
    this.checkAndLoad();
  },

  checkAndLoad() {
    if (!auth.hasPerm('card_trace')) {
      wx.showToast({ title: '缺少 card_trace 权限', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.loadTrace();
  },

  loadTrace() {
    this.setData({ loading: true });
    const queryId = this.data.cardNo;
    if (!queryId) {
      this.setData({ loading: false });
      wx.showToast({ title: '缺少卡号信息', icon: 'none' });
      return;
    }
    auth.callWithAuth('getCardTrace', {
      order_no: queryId
    }).then((res) => {
      const result = res.result || {};
      if (result.success) {
        const logs = (result.logs || []).map((log) => this.formatLog(log));
        const card = result.card || {};
        const stepCount = Array.isArray(card.steps) ? card.steps.length : 0;
        const headerData = card.header_data || {};
        const headerEntries = Object.entries(headerData)
          .filter(([key]) => !key.startsWith('__'))
          .map(([key, value]) => ({
            key, value: String(value || '')
          }));
        const projectName = headerData.project_name || card.project_name || card.prod_name || card.order_no || '';
        this.setData({ card, logs, loading: false, stepCount, projectName, headerEntries });
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  formatLog(log) {
    const isForce = !!log.is_force_unlock;
    const cancelled = !!log.cancelled;
    let statusText, statusType, dotType;
    if (isForce) {
      statusText = '强制解锁';
      statusType = 'danger';
      dotType = 'danger';
    } else if (cancelled) {
      statusText = '放弃填报';
      statusType = 'warning';
      dotType = 'warning';
    } else {
      statusText = '正常提交';
      statusType = 'success';
      dotType = 'success';
    }

    let formEntries = [];
    if (log.form_data && typeof log.form_data === 'object') {
      if (log.form_data.steps_changed && log.form_data.steps_changed.length > 0) {
        formEntries = [{
          key: '变更工序',
          value: log.form_data.steps_changed.map(c => {
            const changes = c.fields.map(f => f.key + ': ' + f.old + ' → ' + f.new).join('; ');
            return c.step_name + '(' + changes + ')';
          }).join(' | ')
        }];
      } else {
        formEntries = Object.entries(log.form_data).map(([key, value]) => ({
          key: key,
          value: typeof value === 'boolean' ? (value ? '是' : '否') : String(value || '')
        })).filter((e) => e.value !== '');
      }
    }

    return {
      ...log,
      timeText: formatFullDateTime(log.submit_time),
      statusText,
      statusType,
      dotType,
      formEntries
    };
  },

});
