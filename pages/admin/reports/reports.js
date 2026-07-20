const auth = require('../../../utils/auth');

Page({
  data: {
    loading: true,
    summary: null,
    trend: [],
    stepBreakdown: [],
    dateFrom: '',
    dateTo: '',
    dateFromText: '开始日期',
    dateToText: '结束日期',
    maxBarValue: 1
  },

  onLoad() {
    if (!auth.requireLogin()) return;
    const today = new Date();
    const thirtyDays = new Date(today.getTime() - 30 * 24 * 3600 * 1000);
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const todayStr = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    const fromStr = thirtyDays.getFullYear() + '-' + pad(thirtyDays.getMonth() + 1) + '-' + pad(thirtyDays.getDate());
    this.setData({ dateFrom: fromStr, dateTo: todayStr, dateFromText: fromStr, dateToText: todayStr });
    this.loadReport();
  },

  loadReport() {
    this.setData({ loading: true });
    auth.callWithAuth('getReportData', {
      date_from: this.data.dateFrom || undefined,
      date_to: this.data.dateTo || undefined
    }).then((res) => {
      const result = res.result || {};
      if (result.success) {
        const maxVal = result.trend.reduce((m, d) => Math.max(m, d.scans, d.created, d.completed), 1);
        this.setData({
          loading: false,
          summary: result.summary,
          trend: result.trend,
          stepBreakdown: result.stepBreakdown || [],
          maxBarValue: maxVal
        });
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  onDateFromChange(e) {
    const val = e.detail.value;
    this.setData({ dateFrom: val, dateFromText: val });
    this.loadReport();
  },

  onDateToChange(e) {
    const val = e.detail.value;
    this.setData({ dateTo: val, dateToText: val });
    this.loadReport();
  }
});
