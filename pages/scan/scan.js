const auth = require('../../utils/auth');

Page({
  data: {
    loading: false,
    lastOrderNo: '',
    operatorName: ''
  },

  onLoad() {
    if (!auth.requireLogin()) return;
    if (!auth.hasPerm('card_submit')) {
      wx.showModal({ title: '无权限', content: '缺少 card_submit 权限，无法扫码报工', showCancel: false });
      return;
    }
    const session = auth.getSession() || {};
    const defaultName = (session.user && (session.user.real_name || session.user.username)) || '操作员';
    const name = wx.getStorageSync('operator_name') || defaultName;
    this.setData({ operatorName: name });
    const last = wx.getStorageSync('last_order_no');
    if (last) this.setData({ lastOrderNo: last });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
    }
  },

  handleScan() {
    if (this.data.loading) return;
    if (!auth.hasPerm('card_submit')) {
      wx.showModal({ title: '无权限', content: '缺少 card_submit 权限', showCancel: false });
      return;
    }
    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        const orderNo = (res.result || '').trim();
        if (!orderNo) {
          wx.showToast({ title: '扫码内容为空', icon: 'error' });
          return;
        }
        this.lockCard(orderNo);
      },
      fail: () => {}
    });
  },

  handleManualInput() {
    if (this.data.loading) return;
    wx.showModal({
      title: '手动输入工单号',
      editable: true,
      placeholderText: '如 A260130011',
      success: (res) => {
        if (res.confirm && res.content) {
          this.lockCard(res.content.trim());
        }
      }
    });
  },

  lockCard(orderNo) {
    this.setData({ loading: true });
    const operatorName = this.data.operatorName || '操作员';
    const app = getApp();

    auth.callWithAuth('getAndLockCard', {
      order_no: orderNo,
      user_name: operatorName
    }).then((res) => {
      this.setData({ loading: false });
      const result = res.result || {};
      if (result.success) {
        app.globalData.lockedCard = {
          cardData: result.cardData,
          templateData: result.templateData,
          operator: operatorName
        };
        wx.setStorageSync('last_order_no', orderNo);
        this.setData({ lastOrderNo: orderNo });
        wx.navigateTo({
          url: '/pages/flow-card/flow-card?order_no=' + encodeURIComponent(orderNo)
        });
      } else {
        wx.showModal({
          title: '无法上锁',
          content: result.msg || '操作失败',
          showCancel: false
        });
      }
    }).catch(() => {
      this.setData({ loading: false });
      wx.showModal({
        title: '调用失败',
        content: '云函数调用异常，请重试',
        showCancel: false
      });
    });
  },

  handleGenQr() {
    wx.navigateTo({ url: '/pages/qr-gen/qr-gen' });
  },

  handleSetOperator() {
    wx.showModal({
      title: '设置操作员',
      editable: true,
      placeholderText: this.data.operatorName,
      success: (res) => {
        if (res.confirm && res.content) {
          const name = res.content.trim();
          this.setData({ operatorName: name });
          wx.setStorageSync('operator_name', name);
        }
      }
    });
  },

  handleSeedData() {
    if (!auth.hasPerm('seed_init')) {
      wx.showModal({ title: '无权限', content: '缺少 seed_init 权限', showCancel: false });
      return;
    }
    wx.showModal({
      title: '初始化测试数据',
      content: '将创建样例流转卡与基础数据。是否继续？',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '初始化中...' });
        auth.callWithAuth('initSeedData')
          .then((r) => {
            wx.hideLoading();
            const result = r.result || {};
            wx.showModal({
              title: result.success ? '初始化完成' : '初始化失败',
              content: result.msg || JSON.stringify(result),
              showCancel: false
            });
          })
          .catch(() => {
            wx.hideLoading();
            wx.showModal({
              title: '初始化失败',
              content: '云函数调用异常',
              showCancel: false
            });
          });
      }
    });
  }
});
