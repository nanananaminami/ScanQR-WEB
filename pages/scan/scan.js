const app = getApp();

Page({
  data: {
    loading: false,
    lastCardNo: '',
    operatorName: '测试员工'
  },

  onLoad() {
    const name = wx.getStorageSync('operator_name');
    if (name) this.setData({ operatorName: name });
    const last = wx.getStorageSync('last_card_no');
    if (last) this.setData({ lastCardNo: last });
  },

  handleScan() {
    if (this.data.loading) return;
    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        const cardNo = (res.result || '').trim();
        if (!cardNo) {
          wx.showToast({ title: '扫码内容为空', icon: 'error' });
          return;
        }
        this.lockCard(cardNo);
      },
      fail: () => {}
    });
  },

  handleManualInput() {
    if (this.data.loading) return;
    wx.showModal({
      title: '手动输入流程卡号',
      editable: true,
      placeholderText: '如 WO-20260712-01',
      success: (res) => {
        if (res.confirm && res.content) {
          this.lockCard(res.content.trim());
        }
      }
    });
  },

  lockCard(cardNo) {
    this.setData({ loading: true });
    const operatorName = this.data.operatorName || '测试员工';

    wx.cloud.callFunction({
      name: 'getAndLockCard',
      data: { card_no: cardNo, user_name: operatorName }
    }).then((res) => {
      this.setData({ loading: false });
      const result = res.result || {};
      if (result.success) {
        app.globalData.lockedCard = {
          cardData: result.cardData,
          templateData: result.templateData,
          operator: operatorName
        };
        wx.setStorageSync('last_card_no', cardNo);
        this.setData({ lastCardNo: cardNo });
        wx.navigateTo({
          url: '/pages/process-form/process-form?card_no=' + encodeURIComponent(cardNo)
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
        content: '请检查云函数 getAndLockCard 是否已部署',
        showCancel: false
      });
    });
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
    wx.showModal({
      title: '初始化测试数据',
      content: '将在云数据库创建质检模板与样例流程卡，用于首次联调。是否继续？',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '初始化中...' });
        wx.cloud.callFunction({ name: 'initSeedData' })
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
              content: '请先部署 initSeedData 云函数',
              showCancel: false
            });
          });
      }
    });
  }
});
