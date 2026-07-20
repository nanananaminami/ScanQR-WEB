const auth = require('../../../utils/auth');
const { formatDateTime } = require('../../../utils/time');

Page({
  data: {
    loading: true,
    logs: [],
    keyword: '',
    statusFilter: 'all',
    page: 1,
    hasMore: false,
    loadingMore: false,
    // 导出
    showExport: false,
    exportDateFrom: '',
    exportDateTo: '',
    exporting: false
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
      wx.showToast({ title: '加载失败', icon: 'none' });
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
      timeText: formatDateTime(log.submit_time),
      statusText,
      statusType,
      formSummary
    };
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
  },

  openExport() {
    this.setData({ showExport: true });
  },

  closeExport() {
    this.setData({ showExport: false });
  },

  onExportDateFrom(e) {
    this.setData({ exportDateFrom: e.detail.value });
  },

  onExportDateTo(e) {
    this.setData({ exportDateTo: e.detail.value });
  },

  doExport() {
    if (this.data.exporting) return;
    this.setData({ exporting: true });
    wx.showLoading({ title: '导出中...' });

    const { keyword, statusFilter, exportDateFrom, exportDateTo } = this.data;
    auth.callWithAuth('exportLogs', {
      keyword: keyword || undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
      date_from: exportDateFrom || undefined,
      date_to: exportDateTo || undefined
    }).then((res) => {
      wx.hideLoading();
      this.setData({ exporting: false, showExport: false });
      const result = res.result || {};
      if (result.success && result.downloadUrl) {
        const url = result.downloadUrl;
        wx.setClipboardData({ data: url });
        wx.showModal({
          title: '导出成功',
          content: '共导出 ' + result.total + ' 条记录。链接已复制到剪贴板。',
          confirmText: '打开文件',
          cancelText: '关闭',
          success: (modalRes) => {
            if (modalRes.confirm) {
              wx.downloadFile({
                url: url,
                success: (dfRes) => {
                  wx.openDocument({
                    filePath: dfRes.tempFilePath,
                    fileType: 'csv',
                    showMenu: true,
                    fail: () => wx.showToast({ title: '请用 WPS 等应用打开', icon: 'none' })
                  });
                },
                fail: () => wx.showToast({ title: '下载失败', icon: 'none' })
              });
            }
          }
        });
      } else {
        wx.showToast({ title: result.msg || '导出失败', icon: 'none' });
      }
    }).catch(() => {
      wx.hideLoading();
      this.setData({ exporting: false });
      wx.showToast({ title: '导出失败', icon: 'none' });
    });
  }
});
