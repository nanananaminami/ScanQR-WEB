const auth = require('../../../utils/auth');

Page({
  data: {
    loading: true,
    stats: {
      todayScans: 0,
      activeCards: 0,
      lockedCards: 0,
      todayExceptions: 0,
      totalLogs: 0,
      wipByWorkstation: [],
      slaBottlenecks: []
    },
    userName: ''
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
    if (!auth.hasPerm('dashboard_view')) {
      wx.switchTab({ url: '/pages/scan/scan' });
      return;
    }
    const session = auth.getSession() || {};
    this.setData({
      userName: (session.user && (session.user.real_name || session.user.username)) || '用户'
    });
    this.loadStats();
  },

  loadStats() {
    this.setData({ loading: true });
    auth.callWithAuth('getDashboardStats').then((res) => {
      const result = res.result || {};
      if (result.success) {
        this.setData({ stats: result.stats, loading: false });
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  goScan() {
    wx.switchTab({ url: '/pages/scan/scan' });
  },

  goCards() {
    wx.switchTab({ url: '/pages/admin/cards/cards' });
  },

  onPullDownRefresh() {
    this.loadStats();
    wx.stopPullDownRefresh();
  }
});
