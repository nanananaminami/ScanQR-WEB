const app = getApp();

Page({
  data: {
    loading: true,
    stats: {
      todayScans: 0,
      activeCards: 0,
      lockedCards: 0,
      todayExceptions: 0,
      totalLogs: 0
    },
    userName: ''
  },

  onLoad() {
    this.waitRoleAndLoad();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
    }
  },

  waitRoleAndLoad() {
    if (app.globalData.roleReady) {
      this.checkRoleAndLoad();
    } else {
      app.globalData.roleCallbacks.push(() => this.checkRoleAndLoad());
    }
  },

  checkRoleAndLoad() {
    const role = app.globalData.role;
    if (role !== 'admin') {
      wx.switchTab({ url: '/pages/scan/scan' });
      return;
    }
    this.setData({ userName: (app.globalData.user && app.globalData.user.name) || '管理员' });
    this.loadStats();
  },

  loadStats() {
    this.setData({ loading: true });
    wx.cloud.callFunction({ name: 'getDashboardStats' })
      .then((res) => {
        const result = res.result || {};
        if (result.success) {
          this.setData({ stats: result.stats, loading: false });
        } else {
          this.setData({ loading: false });
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
        }
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '请部署 getDashboardStats 云函数', icon: 'none' });
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
