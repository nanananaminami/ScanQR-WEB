const auth = require('../../../utils/auth');

Page({
  data: {
    loading: true,
    logs: [],
    keyword: '',
    statusFilter: 'all',
    page: 1,
    hasMore: false,
    loadingMore: false
  },

  onLoad() {
    if (!auth.requireLogin()) return;
    this.checkAndLoad();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
    }
  },

  checkAndLoad() {
    if (!auth.hasPerm('log_view')) {
      wx.switchTab({ url: '/pages/scan/scan' });
      return;
    }
    this.loadLogs(true);
  },

  loadLogs(reset) {
    const page = reset ? 1 : this.data.page;
    if (reset) {
      this.setData({ loading: true });
    } else {
      this.setData({ loadingMore: true });
    }

    auth.callWithAuth('getLogList', {
      keyword: this.data.keyword,
      status: this.data.statusFilter,
      page: page,
      pageSize: 20
    }).then((res) => {
      const result = res.result || {};
      if (result.success) {
        const newLogs = result.logs.map((log) => this.formatLog(log));
        const allLogs = reset ? newLogs : this.data.logs.concat(newLogs);
        this.setData({
          logs: allLogs,
          loading: false,
          loadingMore: false,
          hasMore: result.hasMore,
          page: page
        });
      } else {
        this.setData({ loading: false, loadingMore: false });
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ loading: false, loadingMore: false });
    });
  },

  formatLog(log) {
    const isForce = !!log.is_force_unlock;
    const cancelled = !!log.cancelled;
    let statusText, statusType;
    if (isForce) {
      statusText = '强制解锁';
      statusType = 'danger';
    } else if (cancelled) {
      statusText = '放弃';
      statusType = 'warning';
    } else {
      statusText = '正常提交';
      statusType = 'success';
    }

    let formSummary = '';
    if (log.form_data && typeof log.form_data === 'object') {
      if (log.form_data.steps_changed) {
        formSummary = log.form_data.steps_changed.map(c => c.step_name).join('、') + ' 已更新';
      } else {
        const entries = Object.entries(log.form_data).slice(0, 3);
        formSummary = entries.map(([k, v]) => k + ': ' + (typeof v === 'boolean' ? (v ? '是' : '否') : v)).join(' · ');
      }
    }

    return {
      ...log,
      cardNoDisplay: log.order_no || log.card_no || '-',
      timeText: this.formatTime(log.submit_time),
      statusText,
      statusType,
      formSummary
    };
  },

  formatTime(t) {
    if (!t) return '-';
    const d = new Date(t);
    if (isNaN(d.getTime())) return '-';
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  },

  onSearchChange(e) {
    this.setData({ keyword: e.detail.value || '' });
  },

  onSearchSubmit() {
    this.loadLogs(true);
  },

  onSearchClear() {
    this.setData({ keyword: '' });
    this.loadLogs(true);
  },

  onFilterChange(e) {
    this.setData({ statusFilter: e.currentTarget.dataset.status });
    this.loadLogs(true);
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.setData({ page: this.data.page + 1 });
    this.loadLogs(false);
  },

  goTrace(e) {
    const orderNo = e.currentTarget.dataset.orderNo;
    wx.navigateTo({ url: '/pages/admin/trace/trace?order_no=' + encodeURIComponent(orderNo) });
  },

  onPullDownRefresh() {
    this.loadLogs(true);
    wx.stopPullDownRefresh();
  }
});
