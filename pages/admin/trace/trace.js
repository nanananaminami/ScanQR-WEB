const app = getApp();

Page({
  data: {
    loading: true,
    cardNo: '',
    card: null,
    logs: []
  },

  onLoad(options) {
    const cardNo = options.card_no ? decodeURIComponent(options.card_no) : '';
    this.setData({ cardNo });
    this.waitRoleAndLoad();
  },

  waitRoleAndLoad() {
    if (app.globalData.roleReady) {
      this.checkRoleAndLoad();
    } else {
      app.globalData.roleCallbacks.push(() => this.checkRoleAndLoad());
    }
  },

  checkRoleAndLoad() {
    if (app.globalData.role !== 'admin') {
      wx.switchTab({ url: '/pages/scan/scan' });
      return;
    }
    this.loadTrace();
  },

  loadTrace() {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'getCardTrace',
      data: { card_no: this.data.cardNo }
    }).then((res) => {
      const result = res.result || {};
      if (result.success) {
        const logs = (result.logs || []).map((log) => this.formatLog(log));
        this.setData({ card: result.card, logs, loading: false });
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '请部署 getCardTrace 云函数', icon: 'none' });
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
      formEntries = Object.entries(log.form_data).map(([key, value]) => ({
        key: key,
        value: typeof value === 'boolean' ? (value ? '是' : '否') : String(value || '')
      })).filter((e) => e.value !== '');
    }

    return {
      ...log,
      timeText: this.formatTime(log.submit_time),
      statusText,
      statusType,
      dotType,
      formEntries
    };
  },

  formatTime(t) {
    if (!t) return '-';
    const d = new Date(t);
    if (isNaN(d.getTime())) return '-';
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
});
