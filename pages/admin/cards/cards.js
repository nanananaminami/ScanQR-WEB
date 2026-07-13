const app = getApp();
const db = wx.cloud.database();

Page({
  data: {
    loading: true,
    cards: [],
    filteredCards: [],
    filter: 'all'
  },

  onLoad() {
    this.waitRoleAndLoad();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
    }
    if (app.globalData.roleReady && app.globalData.role === 'admin') {
      this.loadCards();
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
    if (app.globalData.role !== 'admin') {
      wx.switchTab({ url: '/pages/scan/scan' });
      return;
    }
    this.loadCards();
  },

  loadCards() {
    this.setData({ loading: true });
    db.collection('process_cards').where({ status: '加工中' }).orderBy('created_at', 'desc').get()
      .then((res) => {
        const cards = res.data.map((c) => ({
          ...c,
          lockedText: c.is_locked ? '锁定中' : '空闲',
          lockTimeText: c.lock_time ? this.formatTime(c.lock_time) : '-'
        }));
        this.setData({ cards, loading: false });
        this.updateFiltered();
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  formatTime(t) {
    if (!t) return '-';
    const d = new Date(t);
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getMonth() + 1 + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  },

  updateFiltered() {
    const { cards, filter } = this.data;
    const filteredCards = filter === 'locked' ? cards.filter((c) => c.is_locked) : cards;
    this.setData({ filteredCards });
  },

  onFilterChange(e) {
    this.setData({ filter: e.currentTarget.dataset.filter });
    this.updateFiltered();
  },

  confirmUnlock(e) {
    const index = e.currentTarget.dataset.index;
    const card = this.data.filteredCards[index];
    if (!card) return;

    wx.showModal({
      title: '强制解锁确认',
      content: '将强行释放流程卡「' + card.card_no + '」的占用锁（当前持有人：' + (card.locked_by || '未知') + '），对方未提交的数据将丢失。确认继续？',
      confirmText: '强制解锁',
      confirmColor: '#e34d59',
      success: (res) => {
        if (res.confirm) this.doForceUnlock(card);
      }
    });
  },

  doForceUnlock(card) {
    wx.showLoading({ title: '解锁中...' });
    wx.cloud.callFunction({
      name: 'adminForceUnlock',
      data: {
        card_id: card._id,
        user_name: (app.globalData.user && app.globalData.user.name) || '管理员'
      }
    }).then((res) => {
      wx.hideLoading();
      const result = res.result || {};
      if (result.success) {
        wx.showToast({ title: '已强制解锁', icon: 'success' });
        this.loadCards();
      } else {
        wx.showModal({ title: '解锁失败', content: result.msg || '请重试', showCancel: false });
      }
    }).catch(() => {
      wx.hideLoading();
      wx.showModal({ title: '解锁失败', content: '请检查 adminForceUnlock 云函数是否已部署', showCancel: false });
    });
  },

  goTrace(e) {
    const cardNo = e.currentTarget.dataset.cardNo;
    wx.navigateTo({ url: '/pages/admin/trace/trace?card_no=' + encodeURIComponent(cardNo) });
  },

  onPullDownRefresh() {
    this.loadCards();
    wx.stopPullDownRefresh();
  }
});
